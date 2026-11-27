import "@angular/compiler";
import { Injector, runInInjectionContext } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import { Router } from "@angular/router";
import { ToastrService } from "ngx-toastr";

import { BroadcasterService } from "@/libs/abstractions/broadcaster.service";
import { I18nService } from "@/libs/abstractions/i18n.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { BroadcasterService as RealBroadcaster } from "@/libs/services/broadcaster.service";

import { ValidationService } from "@/src-gui/angular/services/validation.service";
import { RendererAuthService } from "@/src-gui/services/electron/rendererAuth.service";

import { AppComponent } from "./app.component";

function app() {
  const broadcaster = new RealBroadcaster();
  const shown: any[] = [];
  const injector = Injector.create({
    providers: [
      { provide: BroadcasterService, useValue: broadcaster },
      { provide: RendererAuthService, useValue: {} },
      { provide: Router, useValue: { navigate: jest.fn() } },
      { provide: ToastrService, useValue: { show: (...args: any[]) => shown.push(args) } },
      { provide: I18nService, useValue: { t: (k: string) => k } },
      { provide: DomSanitizer, useValue: { sanitize: (_: unknown, t: string) => t } },
      { provide: PlatformUtilsService, useValue: {} },
    ],
  });
  const c = runInInjectionContext(injector, () => new AppComponent());
  c.ngOnInit();
  return { broadcaster, shown };
}

describe("AppComponent toasts", () => {
  it("keeps an error toast until it is closed", () => {
    const { broadcaster, shown } = app();

    broadcaster.send({ command: "showToast", type: "error", title: "Sync failed", text: "LDAP" });

    const [, title, options] = shown[0];
    expect(title).toBe("Sync failed");
    expect(options.disableTimeOut).toBe(true);
    expect(options.closeButton).toBe(true);
  });

  it("lets other toasts go by themselves", () => {
    const { broadcaster, shown } = app();

    broadcaster.send({ command: "showToast", type: "success", title: null, text: "Saved" });

    expect(shown[0][2].disableTimeOut).toBeUndefined();
  });
});

describe("ValidationService", () => {
  it("heads the error toast with what failed, not 'An error has occurred.'", () => {
    const toasts: any[] = [];
    const service = new ValidationService(
      { t: (k: string) => k } as any,
      {
        showToast: (...args: any[]) => toasts.push(args),
      } as any,
    );

    service.showError(new Error("The directory server refused the connection."), "Sync failed");

    expect(toasts[0][0]).toBe("error");
    expect(toasts[0][1]).toBe("Sync failed");
    expect(toasts[0][2]).toBe("The directory server refused the connection.");
  });
});
