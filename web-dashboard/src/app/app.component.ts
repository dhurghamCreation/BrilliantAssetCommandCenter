import { Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AvgEfficiencyPipe } from './avg-efficiency.pipe';


type TabId = 'overview' | 'analytics' | 'controls' | 'automation' | 'activity' | 'settings' | 'myview' | 'notifications';
type RoleView = 'operator' | 'maintenance' | 'executive';

interface SystemStats {
  temperature: number;
  grid_load: number;
  output_kw: number;
  fuel_level: number;
  pressure_psi: number;
  vibration_mm: number;
  uptime_hours: number;
  efficiency: number;
  is_locked: boolean;
}


interface AlertItem {
  key: string;
  id: number;
  level: 'info' | 'warning' | 'critical';
  text: string;
  createdAt: Date;
  rootCause?: string;
  suggestedAction?: string;
  assignedTo?: string;
  expectedResolution?: Date;
  acknowledged: boolean;
}

interface ActivityEntry {
  id: number;
  type: 'system' | 'command' | 'insight';
  message: string;
  createdAt: Date;
}

interface AutomationRule {
  id: number;
  name: string;
  enabled: boolean;
  threshold: number;
  action: string;
}

interface CommandRequest {
  action: string;
  context: 'manual' | 'automation';
  timestamp: string;
}

interface CommandResponse {
  success: boolean;
  action: string;
  message?: string;
  appliedDelta?: Partial<SystemStats>;
}

interface ToastItem {
  id: number;
  tone: 'success' | 'warning' | 'error' | 'info';
  text: string;
}

interface PendingCommand {
  id: number;
  action: string;
  status: 'pending' | 'confirmed' | 'failed';
  startedAt: Date;
}

interface MaintenanceTask {
  id: number;
  title: string;
  owner: string;
  done: boolean;
}

interface MaintenanceTicket {
  id: number;
  equipment: string;
  issue: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  createdAt: Date;
  status: 'open' | 'in-progress' | 'resolved';
  assignedTo: string;
}

interface NLQResult {
  id: number;
  query: string;
  answer: string;
  timestamp: Date;
}

interface AnomalyDetection {
  field: keyof SystemStats;
  deviation: number;
  severity: 'low' | 'medium' | 'high';
  detectedAt: Date;
}

interface WidgetDefinition {
  id: string;
  label: string;
  role: RoleView;
  visible: boolean;
}

interface DrillDownDetail {
  kpi: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  trend: 'up' | 'down' | 'stable';
  history: number[];
  subComponents: { name: string; value: number; status: 'good' | 'warning' | 'critical' }[];
  comparison: { label: string; value: number; unit: string }[];
}

interface NotificationItem {
  id: number;
  type: 'alert' | 'system' | 'command' | 'insight';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionable: boolean;
  actionLabel?: string;
  actionCallback?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule, FormsModule, AvgEfficiencyPipe],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent implements OnInit, OnDestroy {
  readonly apiBase = 'http://localhost:8080';
  readonly tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'controls', label: 'Controls' },
    { id: 'automation', label: 'Automation' },
    { id: 'activity', label: 'Activity' },
    { id: 'myview', label: 'My View' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'settings', label: 'Settings' }
  ];

  activeTab: TabId = 'overview';
  activeRole: RoleView = 'operator';
  sys: SystemStats = this.seedStats();
  isWarning = false;
  isBrownout = false;
  isCritical = false;
  isLoading = true;
  isDemoMode = false;

  autoRefresh = true;
  refreshRateMs = 1200;
  refreshRateInputMs = 1200;

  alerts = new Map<string, AlertItem>();
  activities: ActivityEntry[] = [];
  recommendations: string[] = [];
  history: SystemStats[] = [];
  toasts: ToastItem[] = [];
  commandQueue: PendingCommand[] = [];
  activityFilter = '';
  customAction = 'precision-tune';
  maintenanceTasks: MaintenanceTask[] = [
    { id: 1, title: 'Rotor thermal scan', owner: 'Ops-A', done: false },
    { id: 2, title: 'Filter bank inspection', owner: 'Ops-B', done: true },
    { id: 3, title: 'Fuel line pressure test', owner: 'Ops-C', done: false }
  ];
  selectedPreset = 'balanced';
  automationRules: AutomationRule[] = [
    { id: 1, name: 'Overheat Mitigation', enabled: true, threshold: 88, action: 'cooldown' },
    { id: 2, name: 'Brownout Guard', enabled: true, threshold: 90, action: 'load-shed' },
    { id: 3, name: 'Fuel Preservation', enabled: false, threshold: 22, action: 'eco-mode' }
  ];

  // New Features
  lastDataReceived: Date = new Date();
  telemetryLatency: number = 0;
  showTicketModal = false;
  selectedAlertForTicket: AlertItem | null = null;
  maintenanceTickets: MaintenanceTicket[] = [];
  nlqQuery = '';
  nlqResults: NLQResult[] = [];
  showNLQResults = false;
  anomalies: AnomalyDetection[] = [];
  historicalBaselines: Record<string, { mean: number; std: number }> = {};
  whatIfGridLoad = 64;
  whatIfResult: { output_kw: number; efficiency: number; temperature: number } | null = null;
  selectedFlowNode: string | null = null;
  
  // Command Confirmation Modal
  showCommandConfirmModal = false;
  pendingCommandAction: string | null = null;
  pendingCommandContext: 'manual' | 'automation' | null = null;
  
  // Global Filters
  dateRange: 'today' | 'week' | 'month' | 'quarter' = 'today';
  selectedSite = 'all';
  
  // Drill-down state
  drilldownKPI: string | null = null;
  drilldownData: DrillDownDetail | null = null;
  
  // Previous values for trend comparison
  previousValues: Partial<SystemStats> = {};
  
  // Error states
  sensorErrors: Record<string, boolean> = {};

  // My View - Pinned Widgets
  pinnedWidgets: string[] = ['brilliance', 'output', 'risk', 'temperature', 'grid_load'];
  availableWidgets: WidgetDefinition[] = [
    { id: 'brilliance', label: 'Brilliance Score', role: 'executive', visible: true },
    { id: 'asset', label: 'Asset Value Index', role: 'executive', visible: true },
    { id: 'risk', label: 'Predictive Risk', role: 'operator', visible: true },
    { id: 'output', label: 'Output Power', role: 'operator', visible: true },
    { id: 'temperature', label: 'Temperature', role: 'operator', visible: true },
    { id: 'grid_load', label: 'Grid Load', role: 'operator', visible: true },
    { id: 'efficiency', label: 'Efficiency', role: 'maintenance', visible: true },
    { id: 'vibration', label: 'Vibration', role: 'maintenance', visible: true },
    { id: 'fuel', label: 'Fuel Level', role: 'operator', visible: true },
    { id: 'pressure', label: 'Pressure', role: 'maintenance', visible: true },
  ];

  // Notification Center
  notifications: NotificationItem[] = [];
  unreadNotificationCount = 0;
  showNotificationPanel = false;

  // Incident Report Modal
  showIncidentReport = false;
  incidentReportData: any = null;

  // Mitigation Protocol Modal
  showMitigationModal = false;
  mitigationSteps: { id: number; label: string; completed: boolean }[] = [];

  // Historical comparison data
  lastWeekComparison: Record<string, { current: number; lastWeek: number; change: number }> = {};

  private pollTimer?: ReturnType<typeof setInterval>;
  private nextAlertId = 1;
  private nextActivityId = 1;
  private nextToastId = 1;
  private nextCommandId = 1;
  private nextTicketId = 1;
  private nextNLQId = 1;
  private nextNotificationId = 1;
  siren = new Audio('https://www.soundjay.com/buttons/beep-01a.mp3');

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.addActivity('system', 'Dashboard initialized. Awaiting live data stream.');
    this.fetchStats();
    this.startPolling();
    this.initializeBaselines();
    this.initializeLastWeekComparison();
    this.addNotification('system', 'System Online', 'Atlas Prime Operations dashboard initialized successfully.', false);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this.siren.pause();
  }

  // Role-based view switching
  setRole(role: string): void {
    this.activeRole = role as RoleView;
    this.addActivity('system', `Switched to ${role} view.`);
    this.addNotification('system', 'View Changed', `Switched to ${role} view.`, false);
  }

  setTab(tab: TabId): void {
    this.activeTab = tab;
    if (tab === 'notifications') {
      this.showNotificationPanel = true;
    }
  }

  refreshNow(): void {
    this.fetchStats();
    this.pushToast('info', 'Manual refresh started.');
  }

  toggleAutoRefresh(): void {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.startPolling();
      this.addActivity('system', `Auto refresh resumed (${this.refreshRateMs}ms).`);
    } else {
      this.stopPolling();
      this.addActivity('system', 'Auto refresh paused.');
    }
  }

  applyRefreshRate(): void {
    const safe = Math.max(500, Math.min(10000, Number(this.refreshRateInputMs) || 1200));
    this.refreshRateMs = safe;
    this.refreshRateInputMs = safe;
    if (this.autoRefresh) {
      this.startPolling();
    }
    this.addActivity('system', `Refresh interval set to ${safe}ms.`);
  }

  sendCommand(action: string): void {
    this.pendingCommandAction = action;
    this.pendingCommandContext = 'manual';
    this.showCommandConfirmModal = true;
  }

  confirmCommand(): void {
    if (this.pendingCommandAction) {
      this.executeCommand(this.pendingCommandAction, this.pendingCommandContext || 'manual');
    }
    this.closeCommandConfirmModal();
  }

  closeCommandConfirmModal(): void {
    this.showCommandConfirmModal = false;
    this.pendingCommandAction = null;
    this.pendingCommandContext = null;
  }

  sendCustomCommand(): void {
    const normalized = (this.customAction || '').trim().toLowerCase();
    if (!normalized) {
      this.pushToast('warning', 'Custom command is empty.');
      return;
    }
    this.executeCommand(normalized, 'manual');
  }

  applyPreset(): void {
    const presets: Record<string, string[]> = {
      balanced: ['precision-tune'],
      performance: ['boost-output', 'pressure-stabilize'],
      resilient: ['eco-mode', 'load-shed']
    };
    (presets[this.selectedPreset] ?? ['precision-tune']).forEach((action) => this.executeCommand(action, 'manual'));
    this.pushToast('success', `Preset ${this.selectedPreset} deployed.`);
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((item) => item.id !== id);
  }

  filteredActivities(): ActivityEntry[] {
    const q = this.activityFilter.trim().toLowerCase();
    if (!q) {
      return this.activities;
    }
    return this.activities.filter((item) => item.message.toLowerCase().includes(q) || item.type.includes(q));
  }

  maintenanceCompletion(): number {
    const total = this.maintenanceTasks.length;
    if (total === 0) {
      return 0;
    }
    const done = this.maintenanceTasks.filter((task) => task.done).length;
    return Math.round((done / total) * 100);
  }

  toggleMaintenanceTask(task: MaintenanceTask): void {
    task.done = !task.done;
    this.addActivity('system', `Task ${task.title} ${task.done ? 'completed' : 'reopened'}.`);
  }

  chartPoints(field: keyof SystemStats, min: number, max: number): string {
    const values = this.history.slice(-24).map((item) => Number(item[field] || 0));
    if (values.length < 2) {
      return '0,36 180,36';
    }
    const scale = (value: number): number => {
      const ratio = (value - min) / Math.max(1, max - min);
      return 40 - this.clamp(ratio, 0, 1) * 36;
    };
    return values
      .map((value, idx) => {
        const x = Math.round((idx / (values.length - 1)) * 180);
        const y = Math.round(scale(value) * 10) / 10;
        return `${x},${y}`;
      })
      .join(' ');
  }

  chartLast(field: keyof SystemStats): number {
    const latest = this.history[this.history.length - 1];
    return Number((latest ? latest[field] : this.sys[field]) || 0);
  }

  chartTrendClass(field: keyof SystemStats): string {
    const values = this.history.slice(-10).map((item) => Number(item[field] || 0));
    if (values.length < 2) return '';
    const recent = values.slice(-3);
    const older = values.slice(0, -3);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    const diff = recentAvg - olderAvg;
    if (diff > 2) return 'warning';
    if (diff > 5) return 'critical';
    return '';
  }

  queueStateClass(status: PendingCommand['status']): string {
    return `state-${status}`;
  }

  playSiren(trigger: boolean): void {
    if (trigger && !this.sys.is_locked) {
      // Only play if not already playing to avoid rapid restarts
      if (this.siren.paused) {
        this.siren.loop = true;
        this.siren.play().catch(() => {});
      }
    } else {
      this.siren.pause();
      this.siren.currentTime = 0;
    }
  }

  // Derived, ordered list of alerts for the template (newest first)
  get alertList(): AlertItem[] {
    return Array.from(this.alerts.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  get activeAlertCount(): number {
    return this.alertList.filter((a) => !a.acknowledged).length;
  }

  trackAlertByKey(_index: number, alert: AlertItem): string {
    return alert.key;
  }

  acknowledgeAlerts(): void {
    let count = 0;
    this.alerts.forEach((alert) => {
      if (!alert.acknowledged) {
        alert.acknowledged = true;
        count++;
      }
    });
    this.addActivity('system', 'All active alerts acknowledged by operator.');
    this.pushToast('success', `${count} alert(s) acknowledged.`);
    this.addNotification('system', 'Alerts Acknowledged', `${count} alert(s) acknowledged.`, false);
  }

  acknowledgeAlert(key: string): void {
    const alert = this.alerts.get(key);
    if (alert && !alert.acknowledged) {
      alert.acknowledged = true;
      this.addActivity('system', `Alert acknowledged: ${alert.text}`);
      this.pushToast('success', 'Alert acknowledged.');
    }
  }

  reactivateAlert(key: string): void {
    const alert = this.alerts.get(key);
    if (alert && alert.acknowledged) {
      alert.acknowledged = false;
      alert.createdAt = new Date();
      this.addActivity('system', `Alert reactivated: ${alert.text}`);
    }
  }

  toggleLock(): void {
    const action = this.sys.is_locked ? 'unlock' : 'lock';
    this.executeCommand(action, 'manual');
  }

  runAutomation(rule: AutomationRule): void {
    this.executeCommand(rule.action, 'automation');
    this.addActivity('insight', `Automation executed: ${rule.name}`);
  }

  toggleRule(rule: AutomationRule): void {
    rule.enabled = !rule.enabled;
    const status = rule.enabled ? 'enabled' : 'disabled';
    this.addActivity('system', `Rule ${rule.name} ${status}.`);
  }

  healthState(): 'excellent' | 'watch' | 'critical' {
    if (this.isCritical) {
      return 'critical';
    }
    if (this.isWarning || this.isBrownout) {
      return 'watch';
    }
    return 'excellent';
  }

  brillianceScore(): number {
    const eff = this.sys.efficiency;
    const loadPenalty = Math.max(0, this.sys.grid_load - 80) * 1.2;
    const heatPenalty = Math.max(0, this.sys.temperature - 84) * 1.4;
    const vibrationPenalty = this.sys.vibration_mm * 3;
    return this.boundScore(100 - loadPenalty - heatPenalty - vibrationPenalty + (eff - 90));
  }

  assetValueIndex(): number {
    const reliability = this.boundScore(100 - this.sys.vibration_mm * 4 - Math.max(0, this.sys.pressure_psi - 150) * 0.7);
    const uptimeBoost = Math.min(12, this.sys.uptime_hours / 24);
    return this.boundScore((this.brillianceScore() * 0.6) + (reliability * 0.4) + uptimeBoost);
  }

  predictiveRiskPercent(): number {
    if (this.history.length < 2) {
      return this.boundScore((100 - this.brillianceScore()) * 0.7);
    }
    const newest = this.history[this.history.length - 1];
    const previous = this.history[this.history.length - 2] ?? newest;
    const tempDelta = newest.temperature - previous.temperature;
    const loadDelta = newest.grid_load - previous.grid_load;
    const trendRisk = Math.max(0, tempDelta * 6) + Math.max(0, loadDelta * 4);
    const baseRisk = (100 - this.brillianceScore()) * 0.7;
    return this.boundScore(baseRisk + trendRisk);
  }

  trendAverage(field: keyof SystemStats): number {
    if (this.history.length === 0) {
      return Number(this.sys[field]) || 0;
    }
    const total = this.history.reduce((sum, item) => sum + Number(item[field] || 0), 0);
    return Number((total / this.history.length).toFixed(1));
  }

  // Data Freshness
  dataFreshnessState(): 'fresh' | 'stale' | 'expired' {
    const seconds = (Date.now() - this.lastDataReceived.getTime()) / 1000;
    if (seconds < 5) return 'fresh';
    if (seconds < 15) return 'stale';
    return 'expired';
  }

  private cachedFreshnessText = '';
  private lastFreshnessUpdate = 0;
  
  dataFreshnessText(): string {
    const now = Date.now();
    const seconds = Math.round((now - this.lastDataReceived.getTime()) / 1000);
    
    // Only update cache if more than 1 second has passed
    if (now - this.lastFreshnessUpdate > 1000) {
      this.lastFreshnessUpdate = now;
      if (seconds < 60) {
        this.cachedFreshnessText = `${seconds}s ago`;
      } else {
        const minutes = Math.floor(seconds / 60);
        this.cachedFreshnessText = `${minutes}m ${seconds % 60}s ago`;
      }
    }
    
    return this.cachedFreshnessText;
  }


  getTrendIndicator(field: keyof SystemStats): 'up' | 'down' | 'stable' {
  if (this.history.length < 2) return 'stable';

  const current = Number(this.sys[field]);
  const previous = Number(this.history[this.history.length - 2][field]);

  // Check if both are valid numbers (not NaN)
  if (isNaN(current) || isNaN(previous)) return 'stable';

  const diff = current - previous;
  if (diff > 0.5) return 'up';
  if (diff < -0.5) return 'down';
  return 'stable';
}

getTrendChangePercent(field: keyof SystemStats): string {
  if (this.history.length < 2) return '';
  
  const current = Number(this.sys[field]);
  const previous = Number(this.history[this.history.length - 2][field]);

  // Professional check for division by zero OR invalid data
  if (!previous || isNaN(current) || isNaN(previous)) return '0.0%';

  const change = ((current - previous) / previous) * 100;
  
  // Use toFixed(1) to avoid long strings like 12.333333%
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}
    getTrendChangeText(field: keyof SystemStats): string {
    if (this.history.length < 2) return '';
    const current = Number(this.sys[field]);
    const previous = Number(this.history[this.history.length - 2][field]);
    const diff = current - previous;
    const direction = diff >= 0 ? 'up' : 'down';
    const absDiff = Math.abs(diff);
    return `${direction} ${absDiff.toFixed(1)} from last reading`;
  }

  // Drill-down for KPIs
  drillDown(kpi: string): void {
    this.drilldownKPI = kpi;
    this.drilldownData = this.buildDrillDownData(kpi);
    this.activeTab = 'analytics';
    this.addActivity('insight', `Drilled down into ${kpi} details.`);
  }

  closeDrillDown(): void {
    this.drilldownKPI = null;
    this.drilldownData = null;
  }

  private buildDrillDownData(kpi: string): DrillDownDetail {
    const history = this.history.slice(-24).map(h => {
      switch (kpi) {
        case 'brilliance': return this.calculateBrillianceFromStats(h);
        case 'asset': return this.calculateAssetFromStats(h);
        case 'risk': return this.calculateRiskFromStats(h);
        case 'output': return h.output_kw;
        case 'temperature': return h.temperature;
        case 'grid_load': return h.grid_load;
        case 'efficiency': return h.efficiency;
        case 'vibration': return h.vibration_mm;
        case 'fuel': return h.fuel_level;
        case 'pressure': return h.pressure_psi;
        default: return 0;
      }
    });

    const currentValue = history[history.length - 1] || 0;
    const previousValue = history.length > 1 ? history[history.length - 2] : currentValue;
    const changePercent = previousValue !== 0 ? ((currentValue - previousValue) / previousValue) * 100 : 0;
    const trend = changePercent > 1 ? 'up' : changePercent < -1 ? 'down' : 'stable';

    const subComponents = this.getSubComponents(kpi);
    const comparison = this.getComparisonData(kpi);

    return {
      kpi,
      currentValue,
      previousValue,
      changePercent,
      trend,
      history,
      subComponents,
      comparison
    };
  }

  private calculateBrillianceFromStats(stats: SystemStats): number {
    const eff = stats.efficiency;
    const loadPenalty = Math.max(0, stats.grid_load - 80) * 1.2;
    const heatPenalty = Math.max(0, stats.temperature - 84) * 1.4;
    const vibrationPenalty = stats.vibration_mm * 3;
    return this.boundScore(100 - loadPenalty - heatPenalty - vibrationPenalty + (eff - 90));
  }

  private calculateAssetFromStats(stats: SystemStats): number {
    const reliability = this.boundScore(100 - stats.vibration_mm * 4 - Math.max(0, stats.pressure_psi - 150) * 0.7);
    const uptimeBoost = Math.min(12, stats.uptime_hours / 24);
    return this.boundScore((this.calculateBrillianceFromStats(stats) * 0.6) + (reliability * 0.4) + uptimeBoost);
  }

  private calculateRiskFromStats(stats: SystemStats): number {
    return this.boundScore((100 - this.calculateBrillianceFromStats(stats)) * 0.7);
  }

  private getSubComponents(kpi: string): { name: string; value: number; status: 'good' | 'warning' | 'critical' }[] {
    switch (kpi) {
      case 'brilliance':
        return [
          { name: 'Efficiency Contribution', value: this.sys.efficiency, status: this.sys.efficiency > 90 ? 'good' : this.sys.efficiency > 80 ? 'warning' : 'critical' },
          { name: 'Load Penalty', value: Math.max(0, this.sys.grid_load - 80) * 1.2, status: this.sys.grid_load < 80 ? 'good' : this.sys.grid_load < 90 ? 'warning' : 'critical' },
          { name: 'Heat Penalty', value: Math.max(0, this.sys.temperature - 84) * 1.4, status: this.sys.temperature < 84 ? 'good' : this.sys.temperature < 90 ? 'warning' : 'critical' },
          { name: 'Vibration Penalty', value: this.sys.vibration_mm * 3, status: this.sys.vibration_mm < 3 ? 'good' : this.sys.vibration_mm < 5 ? 'warning' : 'critical' },
        ];
      case 'output':
        return [
          { name: 'Generator A', value: this.sys.output_kw * 0.4, status: 'good' },
          { name: 'Generator B', value: this.sys.output_kw * 0.35, status: 'good' },
          { name: 'Generator C', value: this.sys.output_kw * 0.25, status: this.sys.output_kw < 400 ? 'warning' : 'good' },
        ];
      case 'temperature':
        return [
          { name: 'Core Temp', value: this.sys.temperature * 0.6, status: this.sys.temperature < 85 ? 'good' : this.sys.temperature < 92 ? 'warning' : 'critical' },
          { name: 'Exhaust Temp', value: this.sys.temperature * 0.8, status: this.sys.temperature < 88 ? 'good' : 'warning' },
          { name: 'Coolant Temp', value: this.sys.temperature * 0.4, status: 'good' },
        ];
      case 'grid_load':
        return [
          { name: 'Primary Feed', value: this.sys.grid_load * 0.5, status: this.sys.grid_load < 85 ? 'good' : 'warning' },
          { name: 'Secondary Feed', value: this.sys.grid_load * 0.3, status: 'good' },
          { name: 'Backup Circuit', value: this.sys.grid_load * 0.2, status: 'good' },
        ];
      default:
        return [
          { name: 'Primary', value: 0, status: 'good' },
          { name: 'Secondary', value: 0, status: 'good' },
        ];
    }
  }

  private getComparisonData(kpi: string): { label: string; value: number; unit: string }[] {
    const lwc = this.lastWeekComparison[kpi];
    return [
      { label: 'Current', value: lwc?.current || 0, unit: this.getUnit(kpi) },
      { label: 'Last Week', value: lwc?.lastWeek || 0, unit: this.getUnit(kpi) },
      { label: 'Change', value: lwc?.change || 0, unit: this.getUnit(kpi) },
      { label: 'Target', value: this.getTarget(kpi), unit: this.getUnit(kpi) },
    ];
  }

  private getUnit(kpi: string): string {
    const units: Record<string, string> = {
      brilliance: 'pts',
      asset: 'pts',
      risk: '%',
      output: 'kW',
      temperature: 'degF',
      grid_load: '%',
      efficiency: '%',
      vibration: 'mm',
      fuel: '%',
      pressure: 'psi',
    };
    return units[kpi] || '';
  }

  private getTarget(kpi: string): number {
    const targets: Record<string, number> = {
      brilliance: 95,
      asset: 90,
      risk: 15,
      output: 500,
      temperature: 82,
      grid_load: 75,
      efficiency: 95,
      vibration: 1.5,
      fuel: 80,
      pressure: 130,
    };
    return targets[kpi] || 0;
  }

  // KPI Tooltips
  getKPITooltip(kpi: string): string {
    const tooltips: Record<string, string> = {
      brilliance: 'Composite score combining efficiency, load, heat, and vibration. Higher is better.',
      asset: 'Reliability-weighted score for asset longevity. Based on vibration, pressure, and uptime.',
      risk: 'Near-term incident risk based on trend analysis. Lower is better.',
      output: 'Real-time power generation output in kilowatts.',
      temperature: 'Current system operating temperature.',
      grid_load: 'Current electrical grid load as percentage of capacity.',
      efficiency: 'Current system efficiency percentage.',
      vibration: 'Current vibration level in millimeters.',
      fuel: 'Current fuel level as percentage of capacity.',
      pressure: 'Current system pressure in PSI.',
    };
    return tooltips[kpi] || '';
  }

  // Error state handling
  getSensorError(field: keyof SystemStats): boolean {
    return this.sensorErrors[field] || false;
  }

  getChange(key: string): number {
    // 1. Check if the object exists
    // 2. Check if the specific key exists
    // 3. Return the change, or 0 if anything is missing
    return this.lastWeekComparison?.[key]?.change ?? 0;
  }

  // app.component.ts
getComparison(key: string) {
  // Returns the object if it exists, otherwise returns a safe empty object
  return this.lastWeekComparison?.[key] || { current: 0, change: 0 };
}

  // Actionable Playbooks
  getActionablePlaybook(): { title: string; action: string; visible: boolean } | null {
    if (this.predictiveRiskPercent() > 70) {
      return {
        title: 'High Risk Protocol',
        action: 'load-shed',
        visible: true
      };
    }
    if (this.isWarning) {
      return {
        title: 'Warning Response',
        action: 'cooldown',
        visible: true
      };
    }
    return null;
  }

  executePlaybook(): void {
    const playbook = this.getActionablePlaybook();
    if (playbook) {
      this.executeCommand(playbook.action, 'automation');
      this.addActivity('insight', `Executed playbook: ${playbook.title}`);
      this.addNotification('system', 'Playbook Executed', `Executed playbook: ${playbook.title}`, false);
    }
  }

  // Contextual Thresholds
  getContextualStatus(field: keyof SystemStats, value: number): 'excellent' | 'warning' | 'critical' {
    const baseline = this.historicalBaselines[field];
    if (!baseline) return 'excellent';
    
    const deviation = Math.abs(value - baseline.mean) / baseline.std;
    
    if (deviation > 2) return 'critical';
    if (deviation > 1) return 'warning';
    return 'excellent';
  }

  // Maintenance Ticket
  openTicketModal(alert: AlertItem): void {
    this.selectedAlertForTicket = alert;
    this.showTicketModal = true;
  }

  closeTicketModal(): void {
    this.showTicketModal = false;
    this.selectedAlertForTicket = null;
  }

  createMaintenanceTicket(): void {
    if (!this.selectedAlertForTicket) return;
    
    const ticket: MaintenanceTicket = {
      id: this.nextTicketId++,
      equipment: 'Atlas Prime Generator',
      issue: this.selectedAlertForTicket.rootCause || this.selectedAlertForTicket.text,
      priority: this.selectedAlertForTicket.level === 'critical' ? 'critical' : 
                this.selectedAlertForTicket.level === 'warning' ? 'high' : 'medium',
      description: `Auto-generated from alert: ${this.selectedAlertForTicket.text}`,
      createdAt: new Date(),
      status: 'open',
      assignedTo: this.selectedAlertForTicket.assignedTo || 'Unassigned'
    };
    
    this.maintenanceTickets = [ticket, ...this.maintenanceTickets];
    this.addActivity('system', `Maintenance ticket #${ticket.id} created for ${ticket.issue}.`);
    this.pushToast('success', `Ticket #${ticket.id} created successfully.`);
    this.addNotification('system', 'Ticket Created', `Maintenance ticket #${ticket.id} created for ${ticket.issue}.`, true);
    this.closeTicketModal();
  }

  // View Incident Report
  viewIncidentReport(): void {
    this.incidentReportData = {
      title: 'Predictive Risk Analysis Report',
      generatedAt: new Date(),
      riskScore: this.predictiveRiskPercent(),
      brillianceScore: this.brillianceScore(),
      contributingFactors: [
        { factor: 'Temperature', value: this.sys.temperature, threshold: 88, status: this.sys.temperature > 88 ? 'exceeded' : 'normal' },
        { factor: 'Grid Load', value: this.sys.grid_load, threshold: 85, status: this.sys.grid_load > 85 ? 'exceeded' : 'normal' },
        { factor: 'Vibration', value: this.sys.vibration_mm, threshold: 4, status: this.sys.vibration_mm > 4 ? 'exceeded' : 'normal' },
        { factor: 'Fuel Level', value: this.sys.fuel_level, threshold: 25, status: this.sys.fuel_level < 25 ? 'low' : 'adequate' },
      ],
      recommendations: this.recommendations,
      trend: this.getTrendIndicator('temperature'),
    };
    this.showIncidentReport = true;
    this.addActivity('insight', 'Incident report generated.');
  }

  closeIncidentReport(): void {
    this.showIncidentReport = false;
    this.incidentReportData = null;
  }

  // Start Mitigation Protocol
  startMitigationProtocol(): void {
    this.mitigationSteps = [
      { id: 1, label: 'Reduce output by 8% to stabilize thermal load', completed: false },
      { id: 2, label: 'Activate auxiliary cooling systems', completed: false },
      { id: 3, label: 'Shift load to secondary grid feed', completed: false },
      { id: 4, label: 'Notify shift supervisor of protocol activation', completed: false },
      { id: 5, label: 'Monitor system response for 5 minutes', completed: false },
    ];
    this.showMitigationModal = true;
    this.addActivity('insight', 'Mitigation protocol initiated.');
    this.addNotification('system', 'Mitigation Protocol', 'Mitigation protocol initiated. Follow the steps to stabilize the system.', true);
  }

  completeMitigationStep(step: { id: number; label: string; completed: boolean }): void {
    step.completed = !step.completed;
    if (step.completed) {
      this.pushToast('success', `Step completed: ${step.label}`);
    }
  }

  closeMitigationModal(): void {
    this.showMitigationModal = false;
    this.mitigationSteps = [];
  }

  // My View - Pinning
  isPinned(widgetId: string): boolean {
    return this.pinnedWidgets.includes(widgetId);
  }

  togglePin(widgetId: string): void {
    const idx = this.pinnedWidgets.indexOf(widgetId);
    if (idx >= 0) {
      this.pinnedWidgets.splice(idx, 1);
      this.pushToast('info', `Widget removed from My View.`);
    } else {
      this.pinnedWidgets.push(widgetId);
      this.pushToast('success', `Widget pinned to My View.`);
    }
    this.addActivity('system', `Widget ${widgetId} ${idx >= 0 ? 'unpinned from' : 'pinned to'} My View.`);
  }

  getPinnedWidgets(): WidgetDefinition[] {
    return this.availableWidgets.filter(w => this.pinnedWidgets.includes(w.id));
  }

  // Deduplicated Notification Center
  // Uses a Map keyed by title to prevent flooding identical notifications.
  private notificationsMap = new Map<string, NotificationItem>();

  addNotification(type: NotificationItem['type'], title: string, message: string, actionable: boolean, actionLabel?: string, actionCallback?: string): void {
    const timestamp = new Date();
    const existing = this.notificationsMap.get(title);
    if (existing) {
      // Update timestamp, keep it read=false if it was already unread, so it stays at top
      existing.timestamp = timestamp;
      existing.read = false;
    } else {
      const notification: NotificationItem = {
        id: this.nextNotificationId++,
        type,
        title,
        message,
        timestamp,
        read: false,
        actionable,
        actionLabel,
        actionCallback,
      };
      this.notificationsMap.set(title, notification);
    }
    // Produce a sorted, capped array for the template
    this.notifications = Array.from(this.notificationsMap.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 50);
    this.unreadNotificationCount = this.notifications.filter(n => !n.read).length;
  }

  markNotificationRead(notification: NotificationItem): void {
    notification.read = true;
    this.unreadNotificationCount = this.notifications.filter(n => !n.read).length;
  }

  markAllNotificationsRead(): void {
    this.notifications.forEach(n => n.read = true);
    this.unreadNotificationCount = 0;
    this.pushToast('info', 'All notifications marked as read.');
  }

  clearNotifications(): void {
    this.notifications = [];
    this.notificationsMap.clear();
    this.unreadNotificationCount = 0;
    this.pushToast('info', 'Notifications cleared.');
  }

  toggleNotificationPanel(): void {
    this.showNotificationPanel = !this.showNotificationPanel;
  }

  getNotificationIcon(type: NotificationItem['type']): string {
    switch (type) {
      case 'alert': return 'alert';
      case 'system': return 'system';
      case 'command': return 'command';
      case 'insight': return 'insight';
      default: return 'info';
    }
  }

  getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // What-If Analysis
  runWhatIfSimulation(): void {
    const loadChange = (this.whatIfGridLoad - this.sys.grid_load) / 100;
    this.whatIfResult = {
      output_kw: this.clamp(this.sys.output_kw * (1 - loadChange * 0.5), 300, 750),
      efficiency: this.clamp(this.sys.efficiency - loadChange * 2, 75, 100),
      temperature: this.clamp(this.sys.temperature + loadChange * 3, 65, 102)
    };
  }

  // NLQ Search
  searchNLQ(): void {
    const query = this.nlqQuery.trim().toLowerCase();
    if (!query) return;

    const result: NLQResult = {
      id: this.nextNLQId++,
      query: this.nlqQuery,
      answer: this.processNLQQuery(query),
      timestamp: new Date()
    };

    this.nlqResults = [result, ...this.nlqResults].slice(0, 10);
    this.showNLQResults = true;
    this.addActivity('insight', `NLQ query: ${this.nlqQuery}`);
  }

  private processNLQQuery(query: string): string {
    if (query.includes('peak') && query.includes('grid load')) {
      const peak = Math.max(...this.history.map(h => h.grid_load));
      return `Peak grid load was ${peak.toFixed(1)}% recorded at ${this.formatTimeFromHistory(peak)}.`;
    }
    if (query.includes('downtime') || query.includes('downtime report')) {
      return `Total downtime this month: 0 hours. System uptime: ${this.sys.uptime_hours.toFixed(1)}h.`;
    }
    if (query.includes('temperature')) {
      return `Current temperature: ${this.sys.temperature.toFixed(1)}F. Average: ${this.trendAverage('temperature').toFixed(1)}F. Trend: ${this.getTrendChangeText('temperature')}.`;
    }
    if (query.includes('efficiency')) {
      return `Current efficiency: ${this.sys.efficiency.toFixed(1)}%. Asset value index: ${this.assetValueIndex()}. Trend: ${this.getTrendChangeText('efficiency')}.`;
    }
    if (query.includes('risk')) {
      return `Current predictive risk: ${this.predictiveRiskPercent()}%. Brilliance score: ${this.brillianceScore()}. ${this.predictiveRiskPercent() > 70 ? 'High risk protocol recommended.' : 'Risk levels are within acceptable range.'}`;
    }
    if (query.includes('output')) {
      return `Current output: ${this.sys.output_kw.toFixed(0)} kW. Trend: ${this.getTrendChangeText('output_kw')}.`;
    }
    if (query.includes('alerts')) {
      return `There are ${this.alertList.length} active alerts. ${this.alertList.filter(a => a.level === 'critical').length} critical, ${this.alertList.filter(a => a.level === 'warning').length} warning.`;
    }
    return `Query processed. No specific data found for "${this.nlqQuery}". Try asking about temperature, grid load, efficiency, output, risk, alerts, or downtime.`;
  }

  private formatTimeFromHistory(value: number): string {
    const idx = this.history.findIndex(h => h.grid_load === value);
    if (idx >= 0) {
      return this.history[idx].temperature.toString();
    }
    return 'N/A';
  }

  // Process Flow Diagram
  selectFlowNode(node: string): void {
    this.selectedFlowNode = node;
    this.addActivity('insight', `Drilled down into ${node} component.`);
  }

  // Predictive Alerting with Root-Cause
  private detectRootCause(): { key: string; level: AlertItem['level']; text: string; rootCause: string; suggestedAction: string; assignedTo: string } | null {
    // Bearing failure detection: temperature + vibration correlation
    if (this.sys.temperature > 80 && this.sys.vibration_mm > 3) {
      return {
        key: 'bearing_failure',
        level: 'warning',
        text: 'Likely bearing failure detected; recommend maintenance within 48 hours.',
        rootCause: 'Bearing wear - correlated temperature and vibration rise',
        suggestedAction: 'Schedule bearing inspection and replacement',
        assignedTo: 'Maintenance Team A'
      };
    }
    
    // Overheating risk
    if (this.sys.temperature > 88) {
      return {
        key: 'thermal_warning',
        level: 'warning',
        text: 'Thermal threshold approaching. Risk of overheating.',
        rootCause: 'Cooling system inefficiency',
        suggestedAction: 'Reduce load and activate cooldown protocol',
        assignedTo: 'Shift Supervisor'
      };
    }
    
    // Grid instability
    if (this.sys.grid_load > 90) {
      return {
        key: 'brownout_risk',
        level: 'critical',
        text: 'Brownout risk detected. Immediate load shedding required.',
        rootCause: 'Grid overload - demand exceeds capacity',
        suggestedAction: 'Activate load-shed profile and reduce output',
        assignedTo: 'Grid Operations'
      };
    }
    
    return null;
  }

  private fetchStats(): void {
    const startTime = Date.now();
    this.http.get<Partial<SystemStats>>(`${this.apiBase}/api/stats`).subscribe({
      next: (res) => {
        this.isDemoMode = false;
        this.sys = this.normalizeStats(res);
        this.lastDataReceived = new Date();
        this.telemetryLatency = Date.now() - startTime;
        this.isLoading = false;
        this.onStatsUpdate();
      },
      error: () => {
        this.isDemoMode = true;
        this.isLoading = false;
        this.sys = this.generateDemoStats(this.sys);
        this.lastDataReceived = new Date();
        this.telemetryLatency = Date.now() - startTime;
        this.onStatsUpdate();
      }
    });
  }

  private onStatsUpdate(): void {
    this.isWarning = this.sys.temperature > 88 || this.sys.fuel_level < 20;
    this.isBrownout = this.sys.grid_load > 90;
    this.isCritical = this.sys.temperature > 95 || this.sys.grid_load > 97;

    this.playSiren(this.isCritical || this.isBrownout);

    this.history = [...this.history.slice(-59), { ...this.sys }];
    this.refreshRecommendations();
    this.evaluateRules();
    this.detectAnomalies();
    this.updateBaselines();
    this.updateLastWeekComparison();

    // Check for root cause alerts
    const rootCauseAlert = this.detectRootCause();
    if (rootCauseAlert) {
      this.addAlert(rootCauseAlert.key, rootCauseAlert.level, rootCauseAlert.text, rootCauseAlert.rootCause, rootCauseAlert.suggestedAction);
      this.addNotification('alert', `${rootCauseAlert.level.toUpperCase()}: ${rootCauseAlert.text}`, 
        `Root cause: ${rootCauseAlert.rootCause}. Assigned to: ${rootCauseAlert.assignedTo}`, true);
    }

    if (this.isCritical) {
      this.addAlert('critical_threshold', 'critical', 'Critical threshold crossed. Immediate intervention required.');
      this.pushToast('error', 'Critical state detected. Please intervene immediately.');
      this.addNotification('alert', 'CRITICAL: System Alert', 'Critical threshold crossed. Immediate intervention required.', true);
    } else if (this.isWarning || this.isBrownout) {
      this.addAlert('system_watch', 'warning', 'System entering watch state. Review controls and load balance.');
      this.addNotification('alert', 'WARNING: System Watch', 'System entering watch state. Review controls and load balance.', true);
    }
  }

  private executeCommand(action: string, context: 'manual' | 'automation'): void {
    const request: CommandRequest = {
      action,
      context,
      timestamp: new Date().toISOString()
    };
    const snapshot = { ...this.sys };
    const commandId = this.enqueueCommand(action);

    // Brief acknowledgement beep for commands (not full siren loop)
    this.siren.play().catch(() => {}).then(() => { setTimeout(() => this.siren.pause(), 200); });
    this.addActivity('command', `Command sent: ${action}`);
    this.applyOptimisticAction(action);

    // If in demo mode, simulate successful command execution
    if (this.isDemoMode) {
      this.markCommandStatus(commandId, 'confirmed');
      this.pushToast('success', `Command ${action} executed (demo mode).`);
      this.addNotification('command', 'Command Executed', `Command ${action} executed successfully in demo mode.`, false);
      this.addActivity('command', `Command ${action} completed (demo mode).`);
      return;
    }

    this.http.post<CommandResponse>(`${this.apiBase}/api/command`, request, {
      headers: {
        'Content-Type': 'application/json'
      }
    }).subscribe({
      next: (response) => {
        if (!response?.success) {
          this.rollbackCommand(snapshot, action, commandId, response?.message || 'Command rejected by backend.');
          return;
        }
        this.markCommandStatus(commandId, 'confirmed');
        if (response.appliedDelta) {
          this.sys = this.normalizeStats({ ...this.sys, ...response.appliedDelta });
        }
        this.pushToast('success', response.message || `Command ${action} confirmed.`);
        this.addNotification('command', 'Command Confirmed', `Command ${action} executed successfully.`, false);
        this.fetchStats();
      },
      error: (err) => {
        console.error('Command failed, trying legacy endpoint:', err);
        // Try legacy GET endpoint as fallback
        this.http.get(`${this.apiBase}/api/command?action=${encodeURIComponent(action)}`).subscribe({
          next: () => {
            this.markCommandStatus(commandId, 'confirmed');
            this.pushToast('info', `Command ${action} applied via legacy endpoint.`);
            this.fetchStats();
          },
          error: () => {
            // If backend is completely unreachable, switch to demo mode and confirm command
            console.warn('Backend unreachable, switching to demo mode');
            this.isDemoMode = true;
            this.markCommandStatus(commandId, 'confirmed');
            this.pushToast('warning', `Backend unreachable. Command ${action} applied in demo mode.`);
            this.addNotification('system', 'Demo Mode Activated', 'Backend connection lost. Operating in demo mode.', false);
            this.addActivity('system', 'Switched to demo mode due to backend connectivity issues.');
          }
        });
      }
    });
  }

  private applyOptimisticAction(action: string): void {
    const delta: Partial<SystemStats> = {};
    if (action === 'boost-output') {
      delta.output_kw = this.clamp(this.sys.output_kw + 35, 300, 750);
      delta.grid_load = this.clamp(this.sys.grid_load + 3, 35, 100);
      delta.temperature = this.clamp(this.sys.temperature + 1.2, 65, 102);
    }
    if (action === 'cooldown') {
      delta.temperature = this.clamp(this.sys.temperature - 2.2, 65, 102);
      delta.output_kw = this.clamp(this.sys.output_kw - 12, 300, 750);
    }
    if (action === 'load-shed') {
      delta.grid_load = this.clamp(this.sys.grid_load - 5, 35, 100);
      delta.output_kw = this.clamp(this.sys.output_kw - 8, 300, 750);
    }
    if (action === 'eco-mode') {
      delta.grid_load = this.clamp(this.sys.grid_load - 2.5, 35, 100);
      delta.efficiency = this.clamp(this.sys.efficiency + 0.8, 75, 100);
    }
    if (action === 'lock') {
      delta.is_locked = true;
    }
    if (action === 'unlock') {
      delta.is_locked = false;
    }
    if (action === 'pressure-stabilize') {
      delta.pressure_psi = this.clamp(this.sys.pressure_psi - 2.5, 90, 170);
    }
    if (action === 'precision-tune') {
      delta.efficiency = this.clamp(this.sys.efficiency + 1.1, 75, 100);
      delta.vibration_mm = this.clamp(this.sys.vibration_mm - 0.2, 0.6, 8);
    }
    this.sys = this.normalizeStats({ ...this.sys, ...delta });
  }

  private rollbackCommand(snapshot: SystemStats, action: string, commandId: number, message: string): void {
    this.sys = snapshot;
    this.markCommandStatus(commandId, 'failed');
    this.addAlert('command_failed', 'warning', message);
    this.pushToast('error', `Rollback applied: ${action}`);
    this.addNotification('alert', 'Command Failed', `Command ${action} failed: ${message}`, true);
  }

  private enqueueCommand(action: string): number {
    const id = this.nextCommandId++;
    const nextItem: PendingCommand = { id, action, status: 'pending', startedAt: new Date() };
    this.commandQueue = [nextItem, ...this.commandQueue].slice(0, 20);
    return id;
  }

  private markCommandStatus(id: number, status: PendingCommand['status']): void {
    this.commandQueue = this.commandQueue.map((item) => (item.id === id ? { ...item, status } : item));
  }

  private pushToast(tone: ToastItem['tone'], text: string): void {
    const id = this.nextToastId++;
    this.toasts = [{ id, tone, text }, ...this.toasts].slice(0, 4);
    setTimeout(() => {
      this.dismissToast(id);
    }, 3600);
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.autoRefresh) {
      return;
    }
    this.pollTimer = setInterval(() => this.fetchStats(), this.refreshRateMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private normalizeStats(raw: Partial<SystemStats> | null | undefined): SystemStats {
    const base = this.seedStats();
    return {
      temperature: this.safeNum(raw?.temperature, base.temperature),
      grid_load: this.safeNum(raw?.grid_load, base.grid_load),
      output_kw: this.safeNum(raw?.output_kw, base.output_kw),
      fuel_level: this.safeNum(raw?.fuel_level, base.fuel_level),
      pressure_psi: this.safeNum(raw?.pressure_psi, base.pressure_psi),
      vibration_mm: this.safeNum(raw?.vibration_mm, base.vibration_mm),
      uptime_hours: this.safeNum(raw?.uptime_hours, base.uptime_hours),
      efficiency: this.safeNum(raw?.efficiency, base.efficiency),
      is_locked: Boolean(raw?.is_locked)
    };
  }

  private seedStats(): SystemStats {
    return {
      temperature: 79,
      grid_load: 64,
      output_kw: 452,
      fuel_level: 68,
      pressure_psi: 121,
      vibration_mm: 2.1,
      uptime_hours: 160,
      efficiency: 93,
      is_locked: false
    };
  }

  private generateDemoStats(previous: SystemStats): SystemStats {
    const wobble = (range: number) => (Math.random() - 0.5) * range;
    return {
      temperature: this.clamp(previous.temperature + wobble(2.8), 70, 100),
      grid_load: this.clamp(previous.grid_load + wobble(5.2), 42, 99),
      output_kw: this.clamp(previous.output_kw + wobble(28), 350, 680),
      fuel_level: this.clamp(previous.fuel_level - Math.random() * 0.35, 5, 100),
      pressure_psi: this.clamp(previous.pressure_psi + wobble(4.6), 95, 170),
      vibration_mm: this.clamp(previous.vibration_mm + wobble(0.25), 1, 7),
      uptime_hours: previous.uptime_hours + (this.refreshRateMs / 3600000),
      efficiency: this.clamp(previous.efficiency + wobble(1.2), 82, 99),
      is_locked: previous.is_locked
    };
  }

  private refreshRecommendations(): void {
    const next: string[] = [];
    if (this.sys.temperature > 88) {
      next.push('Reduce output by 8% for 3 minutes to stabilize thermal load.');
    }
    if (this.sys.grid_load > 90) {
      next.push('Activate load-shed profile B to avoid a brownout event.');
    }
    if (this.sys.fuel_level < 25) {
      next.push('Fuel reserve is low. Schedule replenishment within the next cycle.');
    }
    if (this.sys.vibration_mm > 4) {
      next.push('Vibration is above nominal. Run rotor balancing diagnostics.');
    }
    if (next.length === 0) {
      next.push('System is optimized. Maintain current throughput and monitor trend drift.');
    }
    this.recommendations = next;
  }

  private evaluateRules(): void {
    this.automationRules.forEach((rule) => {
      if (!rule.enabled) {
        return;
      }
      const triggered =
        (rule.action === 'cooldown' && this.sys.temperature > rule.threshold) ||
        (rule.action === 'load-shed' && this.sys.grid_load > rule.threshold) ||
        (rule.action === 'eco-mode' && this.sys.fuel_level < rule.threshold);

      if (triggered) {
        this.addActivity('insight', `Rule check: ${rule.name} threshold reached.`);
      }
    });
  }

  private addAlert(key: string, level: AlertItem['level'], text: string, rootCause?: string, suggestedAction?: string): void {
    const existing = this.alerts.get(key);
    // Once an alert of this type has been acknowledged, keep it quiet until reactivated.
    if (existing?.acknowledged) {
      return;
    }
    // Avoid resetting an identical active alert that was just raised (prevents nagging every poll).
    if (existing && existing.text === text && Date.now() - existing.createdAt.getTime() < 10000) {
      return;
    }
    this.alerts.set(key, {
      key,
      id: this.nextAlertId++,
      level,
      text,
      rootCause,
      suggestedAction,
      assignedTo: level === 'critical' ? 'Shift Supervisor' : 'Maintenance Team',
      expectedResolution: new Date(Date.now() + (level === 'critical' ? 30 : 120) * 60 * 1000),
      createdAt: new Date(),
      acknowledged: false
    });
  }

  private addActivity(type: ActivityEntry['type'], message: string): void {
    this.activities = [{ id: this.nextActivityId++, type, message, createdAt: new Date() }, ...this.activities].slice(0, 80);
  }

  private boundScore(score: number): number {
    return Math.round(this.clamp(score, 0, 100));
  }

  private safeNum(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  // Anomaly Detection - only numeric fields
  private numericFields: ('temperature' | 'grid_load' | 'output_kw' | 'fuel_level' | 'pressure_psi' | 'vibration_mm' | 'efficiency')[] = ['temperature', 'grid_load', 'output_kw', 'fuel_level', 'pressure_psi', 'vibration_mm', 'efficiency'];

  private initializeBaselines(): void {
    this.numericFields.forEach(field => {
      this.historicalBaselines[field] = { mean: this.seedStats()[field] as number, std: 5 };
    });
  }

  private updateBaselines(): void {
    if (this.history.length < 10) return;
    
    this.numericFields.forEach(field => {
      const values = this.history.map(h => Number(h[field]));
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
      const std = Math.sqrt(variance) || 5;
      
      this.historicalBaselines[field] = { mean, std };
    });
  }

  private detectAnomalies(): void {
    this.anomalies = [];
    
    this.numericFields.forEach(field => {
      const baseline = this.historicalBaselines[field];
      if (!baseline) return;
      
      const value = Number(this.sys[field]);
      const deviation = Math.abs(value - baseline.mean) / baseline.std;
      
      if (deviation > 2) {
        this.anomalies.push({
          field,
          deviation,
          severity: deviation > 3 ? 'high' : 'medium',
          detectedAt: new Date()
        });
      }
    });
  }

  // Last Week Comparison
  private initializeLastWeekComparison(): void {
    const fields = ['brilliance', 'asset', 'risk', 'output', 'temperature', 'grid_load', 'efficiency', 'vibration', 'fuel', 'pressure'];
    fields.forEach(field => {
      this.lastWeekComparison[field] = {
        current: 0,
        lastWeek: 0,
        change: 0
      };
    });
  }

  private updateLastWeekComparison(): void {
    const currentBrilliance = this.brillianceScore();
    const currentAsset = this.assetValueIndex();
    const currentRisk = this.predictiveRiskPercent();
    
    this.lastWeekComparison['brilliance'] = {
      current: currentBrilliance,
      lastWeek: currentBrilliance + (Math.random() - 0.5) * 10,
      change: 0
    };
    this.lastWeekComparison['brilliance'].change = this.lastWeekComparison['brilliance'].current - this.lastWeekComparison['brilliance'].lastWeek;
    
    this.lastWeekComparison['output'] = {
      current: this.sys.output_kw,
      lastWeek: this.sys.output_kw + (Math.random() - 0.5) * 50,
      change: 0
    };
    this.lastWeekComparison['output'].change = this.lastWeekComparison['output'].current - this.lastWeekComparison['output'].lastWeek;
    
    this.lastWeekComparison['temperature'] = {
      current: this.sys.temperature,
      lastWeek: this.sys.temperature + (Math.random() - 0.5) * 5,
      change: 0
    };
    this.lastWeekComparison['temperature'].change = this.lastWeekComparison['temperature'].current - this.lastWeekComparison['temperature'].lastWeek;
    
    this.lastWeekComparison['grid_load'] = {
      current: this.sys.grid_load,
      lastWeek: this.sys.grid_load + (Math.random() - 0.5) * 10,
      change: 0
    };
    this.lastWeekComparison['grid_load'].change = this.lastWeekComparison['grid_load'].current - this.lastWeekComparison['grid_load'].lastWeek;
  }

  // Executive KPIs
  siteComparison(): { site: string; efficiency: number; output: number }[] {
    return [
      { site: 'Site A', efficiency: 92, output: 452 },
      { site: 'Site B', efficiency: 87, output: 398 },
      { site: 'Site C', efficiency: 94, output: 512 }
    ];
  }

  costPerUnit(): number {
    return Number((1000 / this.sys.output_kw).toFixed(2));
  }

  mtbf(): number {
    return Math.round(this.sys.uptime_hours * 1.5);
  }

  // Helper for template
  getMaxValue(values: number[]): number {
    if (!values || values.length === 0) return 1;
    return Math.max(...values, 1);
  }

  getWidgetValue(widgetId: string): number {
    switch (widgetId) {
      case 'brilliance': return this.brillianceScore();
      case 'asset': return this.assetValueIndex();
      case 'risk': return this.predictiveRiskPercent();
      case 'output': return this.sys.output_kw;
      case 'temperature': return this.sys.temperature;
      case 'grid_load': return this.sys.grid_load;
      case 'efficiency': return this.sys.efficiency;
      case 'vibration': return this.sys.vibration_mm;
      case 'fuel': return this.sys.fuel_level;
      case 'pressure': return this.sys.pressure_psi;
      default: return 0;
    }
  }
  
  

  getWidgetUnit(widgetId: string): string {
    return this.getUnit(widgetId);
  }

  getWidgetTrend(widgetId: string): 'up' | 'down' | 'stable' {
    const fieldMap: Record<string, keyof SystemStats> = {
      'output': 'output_kw',
      'temperature': 'temperature',
      'grid_load': 'grid_load',
      'efficiency': 'efficiency',
      'vibration': 'vibration_mm',
      'fuel': 'fuel_level',
      'pressure': 'pressure_psi',
    };
    const field = fieldMap[widgetId];
    if (field) return this.getTrendIndicator(field);
    return 'stable';
  }

  getWidgetChangePercent(widgetId: string): string {
    const fieldMap: Record<string, keyof SystemStats> = {
      'output': 'output_kw',
      'temperature': 'temperature',
      'grid_load': 'grid_load',
      'efficiency': 'efficiency',
      'vibration': 'vibration_mm',
      'fuel': 'fuel_level',
      'pressure': 'pressure_psi',
    };
    const field = fieldMap[widgetId];
    if (field) return this.getTrendChangePercent(field);
    return '';
  }

  getWidgetStatus(widgetId: string): 'excellent' | 'warning' | 'critical' {
    const fieldMap: Record<string, keyof SystemStats> = {
      'output': 'output_kw',
      'temperature': 'temperature',
      'grid_load': 'grid_load',
      'efficiency': 'efficiency',
      'vibration': 'vibration_mm',
      'fuel': 'fuel_level',
      'pressure': 'pressure_psi',
    };
    const field = fieldMap[widgetId];
    if (field) return this.getContextualStatus(field, Number(this.sys[field]));
    return 'excellent';
  }
}