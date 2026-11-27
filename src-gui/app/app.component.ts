import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  SecurityContext,
  ViewChild,
  ViewContainerRef,
  inject,
} from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import { Router, RouterOutlet } from "@angular/router";
import { IndividualConfig, ToastrService } from "ngx-toastr";

import { BroadcasterService } from "@/libs/abstractions/broadcaster.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";

import { RendererAuthService } from "@/src-gui/services/electron/rendererAuth.service";

const BroadcasterSubscriptionId = "AppComponent";

@Component({
  selector: "app-root",
  styles: [],
  template: ` <ng-template #settings></ng-template>
    <router-outlet></router-outlet>`,
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
})
export class AppComponent implements OnInit {
  @ViewChild("settings", { read: ViewContainerRef, static: true }) settingsRef: ViewContainerRef;

  private broadcasterService = inject(BroadcasterService);
  private authService = inject(RendererAuthService);
  private router = inject(Router);
  private toastrService = inject(ToastrService);
  private i18nService = inject(I18nService);
  private sanitizer = inject(DomSanitizer);
  private platformUtilsService = inject(PlatformUtilsService);

  // The sync schedule (its timer and the scheduled syncs) runs in the main process: see MessagingMain.
  ngOnInit() {
    this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
      switch (message.command) {
        case "logout":
          this.logOut(!!message.expired, !!message.forgetSecrets);
          break;
        case "showToast":
          this.showToast(message);
          break;
        case "ssoCallback":
          this.router.navigate(["sso"], {
            queryParams: { code: message.code, state: message.state },
          });
          break;
        default:
      }
    });
  }

  ngOnDestroy() {
    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
  }

  private async logOut(expired: boolean, forgetSecrets: boolean) {
    await this.authService.logOut(forgetSecrets);
    if (expired) {
      this.platformUtilsService.showToast(
        "warning",
        this.i18nService.t("loggedOut"),
        this.i18nService.t("loginExpired"),
      );
    }
    this.router.navigate(["login"]);
  }

  private showToast(msg: any) {
    let message = "";

    const options: Partial<IndividualConfig> = {};

    if (typeof msg.text === "string") {
      message = msg.text;
    } else if (msg.text.length === 1) {
      message = msg.text[0];
    } else {
      msg.text.forEach(
        (t: string) =>
          (message += "<p>" + this.sanitizer.sanitize(SecurityContext.HTML, t) + "</p>"),
      );
      options.enableHtml = true;
    }
    if (msg.type === "error") {
      // An error is read, maybe copied: it stays until it is closed (a click, or the close button).
      options.disableTimeOut = true;
      options.closeButton = true;
    }
    if (msg.options != null) {
      if (msg.options.trustedHtml === true) {
        options.enableHtml = true;
      }
      if (msg.options.timeout != null && msg.options.timeout > 0) {
        options.timeOut = msg.options.timeout;
      }
    }

    this.toastrService.show(message, msg.title, options, "toast-" + msg.type);
  }
}
