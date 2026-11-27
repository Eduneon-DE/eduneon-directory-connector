import { DatePipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

import { BroadcasterService } from "@/libs/abstractions/broadcaster.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { StateService } from "@/libs/abstractions/state.service";
import type { SyncOutcome } from "@/libs/services/sync.service";
import { isValidSyncInterval } from "@/libs/utils/syncInterval";

import { ApiActionDirective } from "@/src-gui/angular/directives/api-action.directive";
import { I18nPipe } from "@/src-gui/angular/pipes/i18n.pipe";
import { RendererSyncService } from "@/src-gui/services/electron/rendererSync.service";

type SyncResult = Awaited<ReturnType<RendererSyncService["run"]>>;

const BroadcasterSubscriptionId = "DashboardComponent";

@Component({
  selector: "app-dashboard",
  templateUrl: "dashboard.component.html",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ApiActionDirective, DatePipe, FormsModule, I18nPipe],
})
export class DashboardComponent implements OnInit, OnDestroy {
  simPromise = signal<Promise<unknown>>(null);
  preview = signal<Awaited<ReturnType<RendererSyncService["preview"]>> | null>(null);
  syncPromise = signal<Promise<SyncResult>>(null);
  startPromise = signal<Promise<any>>(null);
  lastGroupSync = signal<Date>(null);
  lastUserSync = signal<Date>(null);
  syncRunning = signal(false);
  /** A directory type is chosen in Settings: without one there is nothing to sync, and saying so is not an error. */
  directoryReady = signal(true);
  /** What Cockpit did with the last upload from this window. */
  lastResult = signal<{ message: string; needsAttention: boolean } | null>(null);

  /** Counts Stop presses, so a Start whose first sync is still running can tell it was stopped. */
  private stops = 0;

  private cdr = inject(ChangeDetectorRef);
  private syncService = inject(RendererSyncService);
  private i18nService = inject(I18nService);
  private broadcasterService = inject(BroadcasterService);
  private messagingService = inject(MessagingService);
  private platformUtilsService = inject(PlatformUtilsService);
  private stateService = inject(StateService);

  async ngOnInit() {
    this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
      switch (message.command) {
        case "dirSyncCompleted":
          // Every sync ends here, scheduled ones too: show what the last one did.
          this.showResult(message);
          await this.updateLastSync();
          this.cdr.markForCheck();
          break;
        // The schedule can change while this tab is open (Stop, a check that re-arms it).
        case "syncScheduleStarted":
        case "syncScheduleStopped":
          this.syncRunning.set(message.command === "syncScheduleStarted");
          break;
        default:
          break;
      }
    });

    this.syncRunning.set(!!(await this.stateService.getSyncingDir()));
    this.directoryReady.set((await this.stateService.getDirectoryType()) != null);
    await this.updateLastSync();
  }

  async ngOnDestroy() {
    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
  }

  async start() {
    if (!isValidSyncInterval((await this.stateService.getSync())?.interval)) {
      // The schedule would never run: say so instead of showing it as on.
      this.platformUtilsService.showToast("error", null, this.i18nService.t("intervalMin"));
      return;
    }
    const stops = this.stops;
    const promise = this.syncService.run(false, false);
    this.startPromise.set(promise);
    await promise;
    if (stops !== this.stops) {
      // Stop was pressed while the first sync ran.
      return;
    }
    this.messagingService.send("scheduleNextDirSync");
    this.syncRunning.set(true);
    this.platformUtilsService.showToast("success", null, this.i18nService.t("syncingStarted"));
  }

  async stop() {
    this.stops++;
    this.messagingService.send("cancelDirSync");
    this.syncRunning.set(false);
    this.platformUtilsService.showToast("success", null, this.i18nService.t("syncingStopped"));
  }

  async sync() {
    const promise = this.syncService.run(false, false);
    this.syncPromise.set(promise);
    const result = await promise;
    const groupCount = result[0] != null ? result[0].length : 0;
    const userCount = result[1] != null ? result[1].length : 0;
    // What Cockpit did with the upload is the news; the local counts only describe the preview.
    const outcome = result[2];
    if (outcome != null) {
      this.lastResult.set({ message: outcome.message, needsAttention: !!outcome.needsAttention });
    }
    if (outcome?.refused) {
      this.platformUtilsService.showToast("warning", null, outcome.message, { timeout: 15000 });
      return;
    }
    this.platformUtilsService.showToast(
      outcome?.needsAttention ? "warning" : outcome?.status === "synced" ? "success" : "info",
      outcome != null ? this.i18nService.t("syncingComplete") : null,
      outcome?.message ??
        this.i18nService.t("syncCounts", groupCount.toString(), userCount.toString()),
      outcome != null ? { timeout: 15000 } : undefined,
    );
  }

  /** What a sync would send, per object type: the whole directory under the root path, nothing filtered here. */
  async simulate() {
    this.preview.set(null);
    try {
      const promise = this.syncService.preview();
      this.simPromise.set(promise);
      this.preview.set(await promise);
    } catch {
      this.preview.set(null);
    } finally {
      this.cdr.markForCheck();
    }
  }

  /** The outcome Cockpit gave, or why the sync failed, from a dirSyncCompleted message. */
  private showResult(message: { outcome?: SyncOutcome; error?: string }) {
    if (message.outcome != null) {
      this.lastResult.set({
        message: message.outcome.message,
        needsAttention: !!message.outcome.needsAttention,
      });
    } else if (message.error != null) {
      this.lastResult.set({
        message: `The last sync failed: ${message.error}`,
        needsAttention: true,
      });
    }
  }

  private async updateLastSync() {
    this.lastGroupSync.set(await this.stateService.getLastGroupSync());
    this.lastUserSync.set(await this.stateService.getLastUserSync());
  }
}
