import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'avgEfficiency',
  standalone: true
})
export class AvgEfficiencyPipe implements PipeTransform {
  transform(sites: { site: string; efficiency: number; output: number }[]): number {
    if (!sites || sites.length === 0) return 0;
    const total = sites.reduce((sum, site) => sum + site.efficiency, 0);
    return Math.round(total / sites.length);
  }
}