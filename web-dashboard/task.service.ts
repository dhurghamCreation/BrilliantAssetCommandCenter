import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  // This imports list tells Angular to allow the use of 'http' and 'ngFor'
  imports: [CommonModule, HttpClientModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent implements OnInit {
  // 1. We define 'stats' here so the red lines on 'this.stats' disappear
  stats: any;
   lastWeekComparison: any = {};

   getTrendChange(key: string): number {
    return this.lastWeekComparison && this.lastWeekComparison[key] 
      ? this.lastWeekComparison[key].change 
      : 0;
  }
  // 2. We put 'http' in the constructor so 'this.http' becomes valid
  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.getTasks();
    // Refresh the data every 2 seconds
    setInterval(() => this.getTasks(), 2000);
  }

  // 3. The function MUST be inside the export class curly braces
  getTasks() {
    this.http.get<any>('http://localhost:8080/api/stats').subscribe({
      next: (data) => {
        this.stats = data;
        console.log('Data received from Go:', data);
      },
      error: (err) => {
        console.error('Is the Go Backend running? Error:', err);
      }
    });
  }
}