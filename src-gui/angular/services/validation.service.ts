import { Injectable } from "@angular/core";

import { I18nService } from "@/libs/abstractions/i18n.service";
import { PlatformUtilsService } from "@/libs/abstractions/platformUtils.service";
import { ErrorResponse } from "@/libs/models/response/errorResponse";

@Injectable()
export class ValidationService {
  constructor(
    private i18nService: I18nService,
    private platformUtilsService: PlatformUtilsService,
  ) {}

  /** @param title what failed, as the toast's heading; without one the toast has none. */
  showError(data: any, title: string = null): string[] {
    const defaultErrorMessage = this.i18nService.t("unexpectedError");
    let errors: string[] = [];

    if (data != null && typeof data === "string") {
      errors.push(data);
    } else if (data == null || typeof data !== "object") {
      errors.push(defaultErrorMessage);
    } else if (data.validationErrors != null) {
      errors = errors.concat((data as ErrorResponse).getAllMessages());
    } else {
      errors.push(data.message ? data.message : defaultErrorMessage);
    }

    if (errors.length === 1) {
      this.platformUtilsService.showToast("error", title, errors[0]);
    } else if (errors.length > 1) {
      this.platformUtilsService.showToast("error", title, errors);
    }

    return errors;
  }
}
