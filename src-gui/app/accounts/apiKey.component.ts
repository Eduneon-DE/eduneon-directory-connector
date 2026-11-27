import { NgClass } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  ViewChild,
  ViewContainerRef,
  inject,
  signal,
} from "@angular/core";
import { outputToObservable } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { takeUntil } from "rxjs";

import { EnvironmentService } from "@/libs/abstractions/environment.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { LogService } from "@/libs/abstractions/log.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";

import { A11yTitleDirective } from "@/src-gui/angular/directives/a11y-title.directive";
import { ApiActionDirective } from "@/src-gui/angular/directives/api-action.directive";
import { I18nPipe } from "@/src-gui/angular/pipes/i18n.pipe";
import { ModalService } from "@/src-gui/angular/services/modal.service";
import { RendererAuthService } from "@/src-gui/services/electron/rendererAuth.service";

import { EnvironmentComponent } from "./environment.component";

@Component({
  selector: "app-apiKey",
  templateUrl: "apiKey.component.html",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yTitleDirective, ApiActionDirective, FormsModule, I18nPipe, NgClass],
})
// There is an eslint exception made here due to semantics.
// The eslint rule expects a typical takeUntil() pattern involving component destruction.
// The only subscription in this component is closed from a child component, confusing eslint.
// https://github.com/cartant/eslint-plugin-rxjs-angular/blob/main/docs/rules/prefer-takeuntil.md
//
// eslint-disable-next-line rxjs-angular-x/prefer-takeuntil
export class ApiKeyComponent {
  @ViewChild("environment", { read: ViewContainerRef, static: true })
  environmentModal: ViewContainerRef;

  apiToken = signal("");
  directoryId = signal("");
  organizationId = signal("");
  formPromise = signal<Promise<any>>(null);
  showSecret = signal(false);

  readonly successRoute = "/tabs/dashboard";

  private router = inject(Router);
  private authService = inject(RendererAuthService);
  private i18nService = inject(I18nService);
  private platformUtilsService = inject(PlatformUtilsService);
  private modalService = inject(ModalService);
  private logService = inject(LogService);
  private environmentService = inject(EnvironmentService);

  /** Cockpit's page for API tokens, on the server this connector logs in to. */
  tokenPageUrl() {
    return (
      this.environmentService.getWebVaultUrl().replace(/\/+$/, "") + "/platform/service-accounts"
    );
  }

  async submit() {
    const apiToken = this.apiToken().trim();
    if (apiToken === "") {
      this.platformUtilsService.showToast(
        "error",
        this.i18nService.t("loginFailed"),
        this.i18nService.t("apiTokenRequired"),
      );
      return;
    }

    try {
      const rawDirectoryId = this.directoryId().trim();
      const rawOrganizationId = this.organizationId().trim();
      const promise = this.authService.logIn({
        apiToken,
        directoryId: rawDirectoryId === "" ? undefined : Number(rawDirectoryId),
        organizationId: rawOrganizationId === "" ? undefined : Number(rawOrganizationId),
      });
      this.formPromise.set(promise);
      await promise;
      this.router.navigate([this.successRoute]);
    } catch (e) {
      this.logService.error(e);
    }
  }

  async settings() {
    const [modalRef, childComponent] = await this.modalService.openViewRef<EnvironmentComponent>(
      EnvironmentComponent,
      this.environmentModal,
    );

    outputToObservable(childComponent.onSaved)
      .pipe(takeUntil(modalRef.onClosed))
      .subscribe(() => {
        modalRef.close();
      });
  }

  toggleSecret() {
    this.showSecret.update((v) => !v);
    document.getElementById("api_token").focus();
  }
}
