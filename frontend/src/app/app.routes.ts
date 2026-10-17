import { Routes } from '@angular/router';
import { BlindReviewComponent } from './blind-review.component';

export const routes: Routes = [
  { path: 'review', component: BlindReviewComponent },
  { path: '', pathMatch: 'full', children: [] }
];
