import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component'; // This must match the filename!

bootstrapApplication(AppComponent).catch((err) => console.error(err));