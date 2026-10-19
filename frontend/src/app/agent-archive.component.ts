import {Component,Input,Output,EventEmitter,ViewChild,ElementRef,OnDestroy} from '@angular/core';
import {CommonModule} from '@angular/common';
import {Subscription} from 'rxjs';
import {AgentIdentity,AgentService} from './services/agent.service';

@Component({selector:'app-agent-archive',standalone:true,imports:[CommonModule],template:`
<button type="button" class="archive-button" [attr.aria-label]="'Remove ' + agent.name + ' (' + agent.id + ')'" [disabled]="pending" (click)="open()" title="Remove agent from Available Agents">
<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>
<dialog #confirmation (click)="backdrop($event)" (cancel)="cancelEvent($event)" (close)="error=''">
<p>Are you sure you want to delete this agent?</p>
<p *ngIf="error" role="alert">{{error}}</p>
<button type="button" (click)="remove()" [disabled]="pending">REMOVE</button>
<button type="button" (click)="cancel()" [disabled]="pending">CANCEL</button>
</dialog>`,styles:[`:host{float:right}.archive-button{padding:.3rem;line-height:1}dialog{max-width:26rem;border:1px solid #888;border-radius:.4rem;padding:1.25rem}dialog::backdrop{background:#0005}dialog button{margin-right:.5rem}[role=alert]{color:#a22}`]})
export class AgentArchiveComponent implements OnDestroy {
 @Input({required:true}) agent!:AgentIdentity;
 @Output() archived=new EventEmitter<string>();
 @ViewChild('confirmation',{static:true}) confirmation!:ElementRef<HTMLDialogElement>;
 pending=false;error='';private request?:Subscription;
 constructor(private agents:AgentService){}
 open(){if(!this.pending){this.error='';this.confirmation.nativeElement.showModal();}}
 cancel(){if(!this.pending)this.confirmation.nativeElement.close();}
 cancelEvent(event:Event){if(this.pending)event.preventDefault();}
 backdrop(event:MouseEvent){if(event.target===this.confirmation.nativeElement)this.cancel();}
 remove(){if(this.pending||!this.confirmation.nativeElement.open)return;this.pending=true;this.error='';
  this.request=this.agents.archiveAgent(this.agent.id).subscribe({next:()=>{this.pending=false;this.confirmation.nativeElement.close();this.archived.emit(this.agent.id);},error:err=>{this.pending=false;this.error=err.error?.error||'Could not remove agent. Try again.';}});
 }
 ngOnDestroy(){this.request?.unsubscribe();}
}
