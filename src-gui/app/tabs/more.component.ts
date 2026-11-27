import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from "@angular/core";

import { BroadcasterService } from "@/libs/abstractions/broadcaster.service";
import { EnvironmentService } from "@/libs/abstractions/environment.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { MessagingService } from "@/libs/abstractions/messaging.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { StateService } from "@/libs/abstractions/state.service";

import { I18nPipe } from "@/src-gui/angular/pipes/i18n.pipe";

const BroadcasterSubscriptionId = "MoreComponent";

@Component({
  selector: "app-more",
  templateUrl: "more.component.html",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [I18nPipe],
})
export class MoreComponent implements OnInit, OnDestroy {
  version = signal("");
  year = signal("");
  checkingForUpdate = signal(false);
  /** Where this app syncs to: the Cockpit server and the directory there (name and id). */
  serverUrl = signal("");
  directoryName = signal<string>(null);
  directoryId = signal<string>(null);

  private platformUtilsService = inject(PlatformUtilsService);
  private i18nService = inject(I18nService);
  private messagingService = inject(MessagingService);
  private broadcasterService = inject(BroadcasterService);
  private stateService = inject(StateService);
  private environmentService = inject(EnvironmentService);

  async ngOnInit() {
    this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
      switch (message.command) {
        case "checkingForUpdate":
          this.checkingForUpdate.set(true);
          break;
        case "doneCheckingForUpdate":
          this.checkingForUpdate.set(false);
          break;
        default:
          break;
      }
    });

    this.year.set(new Date().getFullYear().toString());
    this.version.set(await this.platformUtilsService.getApplicationVersion());
    this.serverUrl.set(this.environmentService.getWebVaultUrl());
    this.directoryName.set(await this.stateService.getEntityId());
    this.directoryId.set(await this.stateService.getOrganizationId());
  }

  ngOnDestroy() {
    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
  }

  update() {
    this.messagingService.send("checkForUpdate");
  }

  async logOut() {
    const confirmed = await this.platformUtilsService.showDialog(
      this.i18nService.t("logOutConfirmation"),
      this.i18nService.t("logOut"),
      this.i18nService.t("yes"),
      this.i18nService.t("cancel"),
    );
    if (confirmed) {
      // Logging out on purpose also removes the directory's password: an automatic logout (a
      // revoked token) only removes the token.
      this.messagingService.send("logout", { forgetSecrets: true });
    }
  }

  async clearCache() {
    await this.stateService.clearSyncSettings(true);
    this.platformUtilsService.showToast("success", null, this.i18nService.t("syncCacheCleared"));
  }
}
