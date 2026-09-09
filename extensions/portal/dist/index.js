var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/ms/index.js"(exports2, module2) {
    var s = 1e3;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;
    module2.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n * y;
        case "weeks":
        case "week":
        case "w":
          return n * w;
        case "days":
        case "day":
        case "d":
          return n * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n * h;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n * m;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n;
        default:
          return void 0;
      }
    }
    function fmtShort(ms2) {
      var msAbs = Math.abs(ms2);
      if (msAbs >= d) {
        return Math.round(ms2 / d) + "d";
      }
      if (msAbs >= h) {
        return Math.round(ms2 / h) + "h";
      }
      if (msAbs >= m) {
        return Math.round(ms2 / m) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms2 / s) + "s";
      }
      return ms2 + "ms";
    }
    function fmtLong(ms2) {
      var msAbs = Math.abs(ms2);
      if (msAbs >= d) {
        return plural(ms2, msAbs, d, "day");
      }
      if (msAbs >= h) {
        return plural(ms2, msAbs, h, "hour");
      }
      if (msAbs >= m) {
        return plural(ms2, msAbs, m, "minute");
      }
      if (msAbs >= s) {
        return plural(ms2, msAbs, s, "second");
      }
      return ms2 + " ms";
    }
    function plural(ms2, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms2 / n) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => src_default
});
module.exports = __toCommonJS(src_exports);
var import_node_crypto = require("node:crypto");

// node_modules/@directus/errors/dist/index.js
var import_ms = __toESM(require_ms(), 1);
var createError = (code, message, status = 500) => {
  return class extends Error {
    name = "DirectusError";
    extensions;
    code = code.toUpperCase();
    status = status;
    constructor(extensions, options) {
      const msg = typeof message === "string" ? message : message(extensions);
      super(msg, options);
      this.extensions = extensions;
    }
    toString() {
      return `${this.name} [${this.code}]: ${this.message}`;
    }
  };
};
var ErrorCode = /* @__PURE__ */ function(ErrorCode$1) {
  ErrorCode$1["AddonNotAvailable"] = "ADDON_NOT_AVAILABLE";
  ErrorCode$1["AddonNotFound"] = "ADDON_NOT_FOUND";
  ErrorCode$1["AddonQuantityOutOfRange"] = "ADDON_QUANTITY_OUT_OF_RANGE";
  ErrorCode$1["ContainsNullValues"] = "CONTAINS_NULL_VALUES";
  ErrorCode$1["ContentTooLarge"] = "CONTENT_TOO_LARGE";
  ErrorCode$1["EmailLimitExceeded"] = "EMAIL_LIMIT_EXCEEDED";
  ErrorCode$1["Forbidden"] = "FORBIDDEN";
  ErrorCode$1["IllegalAssetTransformation"] = "ILLEGAL_ASSET_TRANSFORMATION";
  ErrorCode$1["ImportCyclicalRelation"] = "IMPORT_CYCLICAL_RELATION";
  ErrorCode$1["Internal"] = "INTERNAL_SERVER_ERROR";
  ErrorCode$1["InvalidCredentials"] = "INVALID_CREDENTIALS";
  ErrorCode$1["InvalidForeignKey"] = "INVALID_FOREIGN_KEY";
  ErrorCode$1["InvalidInvite"] = "INVALID_INVITE";
  ErrorCode$1["InvalidIp"] = "INVALID_IP";
  ErrorCode$1["InvalidOtp"] = "INVALID_OTP";
  ErrorCode$1["InvalidPayload"] = "INVALID_PAYLOAD";
  ErrorCode$1["InvalidPathParameter"] = "INVALID_PATH_PARAMETER";
  ErrorCode$1["InvalidProvider"] = "INVALID_PROVIDER";
  ErrorCode$1["InvalidProviderConfig"] = "INVALID_PROVIDER_CONFIG";
  ErrorCode$1["InvalidQuery"] = "INVALID_QUERY";
  ErrorCode$1["InvalidToken"] = "INVALID_TOKEN";
  ErrorCode$1["LicenseInvalid"] = "LICENSE_INVALID";
  ErrorCode$1["LicenseManagedByEnv"] = "LICENSE_MANAGED_BY_ENV";
  ErrorCode$1["LicenseOfflineUnsupported"] = "LICENSE_OFFLINE_UNSUPPORTED";
  ErrorCode$1["LicenseResolveIncomplete"] = "LICENSE_RESOLVE_INCOMPLETE";
  ErrorCode$1["LicenseServiceUnavailable"] = "LICENSE_SERVICE_UNAVAILABLE";
  ErrorCode$1["LimitExceeded"] = "LIMIT_EXCEEDED";
  ErrorCode$1["MethodNotAllowed"] = "METHOD_NOT_ALLOWED";
  ErrorCode$1["NotNullViolation"] = "NOT_NULL_VIOLATION";
  ErrorCode$1["OutOfDate"] = "OUT_OF_DATE";
  ErrorCode$1["OutOfTime"] = "OUT_OF_TIME";
  ErrorCode$1["RangeNotSatisfiable"] = "RANGE_NOT_SATISFIABLE";
  ErrorCode$1["RecordNotUnique"] = "RECORD_NOT_UNIQUE";
  ErrorCode$1["ResourceRestricted"] = "RESOURCE_RESTRICTED";
  ErrorCode$1["RequestsExceeded"] = "REQUESTS_EXCEEDED";
  ErrorCode$1["RouteNotFound"] = "ROUTE_NOT_FOUND";
  ErrorCode$1["ServiceUnavailable"] = "SERVICE_UNAVAILABLE";
  ErrorCode$1["TokenExpired"] = "TOKEN_EXPIRED";
  ErrorCode$1["UnexpectedResponse"] = "UNEXPECTED_RESPONSE";
  ErrorCode$1["UnprocessableContent"] = "UNPROCESSABLE_CONTENT";
  ErrorCode$1["UnsupportedMediaType"] = "UNSUPPORTED_MEDIA_TYPE";
  ErrorCode$1["UserSuspended"] = "USER_SUSPENDED";
  ErrorCode$1["ValueOutOfRange"] = "VALUE_OUT_OF_RANGE";
  ErrorCode$1["ValueTooLong"] = "VALUE_TOO_LONG";
  ErrorCode$1["VersionHashMismatch"] = "VERSION_HASH_MISMATCH";
  return ErrorCode$1;
}({});
var messageConstructor$31 = () => `Addon exists but is not available on the current plan.`;
var AddonNotAvailableError = createError(ErrorCode.AddonNotAvailable, messageConstructor$31, 409);
var messageConstructor$30 = () => `Addon id is not in the catalog for the current subscription.`;
var AddonNotFoundError = createError(ErrorCode.AddonNotFound, messageConstructor$30, 404);
var messageConstructor$29 = () => `Quantity is outside the allowed range for this addon.`;
var AddonQuantityOutOfRangeError = createError(ErrorCode.AddonQuantityOutOfRange, messageConstructor$29, 422);
var messageConstructor$28 = ({ collection, field }) => `Field "${field}" in collection "${collection}" contains null values.`;
var ContainsNullValuesError = createError(ErrorCode.ContainsNullValues, messageConstructor$28, 400);
var ContentTooLargeError = createError(ErrorCode.ContentTooLarge, "Uploaded content is too large.", 413);
var messageConstructor$27 = (extensions) => {
  const message = ["Email sending limit exceeded."];
  if (typeof extensions.points === "number" && typeof extensions.duration === "number") {
    const duration = (0, import_ms.default)(extensions.duration * 1e3, { long: true });
    const plural = extensions.points !== 1 ? "s" : "";
    message.push(`Limit of ${extensions.points} email${plural} every ${duration}.`);
  }
  if (extensions.message) message.push(extensions.message);
  return message.join(" ");
};
var EmailLimitExceededError = createError(ErrorCode.EmailLimitExceeded, messageConstructor$27, 429);
var messageConstructor$26 = (ext) => {
  if (ext?.reason) return ext.reason;
  return `You don't have permission to access this.`;
};
var ForbiddenError = createError(ErrorCode.Forbidden, messageConstructor$26, 403);
var messageConstructor$25 = (extensions) => {
  return `Too many requests, retry after ${(0, import_ms.default)(extensions.reset.getTime() - Date.now())}.`;
};
var HitRateLimitError = createError(ErrorCode.RequestsExceeded, messageConstructor$25, 429);
var IllegalAssetTransformationError = createError(ErrorCode.IllegalAssetTransformation, "Illegal asset transformation.", 400);
var messageConstructor$24 = ({ collections }) => `Can't import collections [${collections.join(", ")}] because they form a relational cycle with only non-nullable foreign keys.`;
var ImportCyclicalRelationError = createError(ErrorCode.ImportCyclicalRelation, messageConstructor$24, 422);
var InternalServerError = createError(ErrorCode.Internal, `An unexpected error occurred.`);
var InvalidCredentialsError = createError(ErrorCode.InvalidCredentials, "Invalid user credentials.", 401);
var messageConstructor$23 = ({ collection, field, value, constraint }) => {
  let message = "Invalid foreign key";
  if (value) message += ` "${value}"`;
  if (field) message += ` for field "${field}"`;
  if (collection) message += ` in collection "${collection}"`;
  if (constraint && !field && !collection) message += ` for constraint "${constraint}"`;
  message += `.`;
  return message;
};
var InvalidForeignKeyError = createError(ErrorCode.InvalidForeignKey, messageConstructor$23, 400);
var InvalidInviteError = createError(ErrorCode.InvalidInvite, () => `This invite is no longer valid.`, 400);
var InvalidIpError = createError(ErrorCode.InvalidIp, "Invalid IP address.", 401);
var InvalidOtpError = createError(ErrorCode.InvalidOtp, "Invalid user OTP.", 401);
var messageConstructor$22 = ({ reason }) => `Invalid payload. ${reason}.`;
var InvalidPayloadError = createError(ErrorCode.InvalidPayload, messageConstructor$22, 400);
var messageConstructor$21 = ({ reason }) => `Invalid path parameter. ${reason}.`;
var InvalidPathParameterError = createError(ErrorCode.InvalidPathParameter, messageConstructor$21, 400);
var InvalidProviderConfigError = createError(ErrorCode.InvalidProviderConfig, "Invalid config.", 503);
var InvalidProviderError = createError(ErrorCode.InvalidProvider, "Invalid provider.", 403);
var messageConstructor$20 = ({ reason }) => `Invalid query. ${reason}.`;
var InvalidQueryError = createError(ErrorCode.InvalidQuery, messageConstructor$20, 400);
var InvalidTokenError = createError(ErrorCode.InvalidToken, "Invalid token.", 403);
var messageConstructor$19 = () => `License key cannot be applied (not found, expired, canceled, already bound elsewhere, malformed).`;
var LicenseInvalidError = createError(ErrorCode.LicenseInvalid, messageConstructor$19, 400);
var messageConstructor$18 = () => `The license is managed via the environment and cannot be modified from the UI.`;
var LicenseManagedByEnvError = createError(ErrorCode.LicenseManagedByEnv, messageConstructor$18, 409);
var messageConstructor$17 = () => `Operation requires the licensing service and is not available in offline mode.`;
var LicenseOfflineUnsupportedError = createError(ErrorCode.LicenseOfflineUnsupported, messageConstructor$17, 409);
var messageConstructor$16 = () => `After applying, the instance is still over limits. Refresh the assessment and retry.`;
var LicenseResolveIncompleteError = createError(ErrorCode.LicenseResolveIncomplete, messageConstructor$16, 422);
var messageConstructor$15 = () => `Licensing service is unreachable.`;
var LicenseServiceUnavailableError = createError(ErrorCode.LicenseServiceUnavailable, messageConstructor$15, 503);
var messageConstructor$14 = ({ category }) => {
  return `${category} limit exceeded.`;
};
var LimitExceededError = createError(ErrorCode.LimitExceeded, messageConstructor$14, 403);
var messageConstructor$13 = (extensions) => `Invalid method "${extensions.current}" used. Should be one of ${extensions.allowed.map((method) => `"${method}"`).join(", ")}.`;
var MethodNotAllowedError = createError(ErrorCode.MethodNotAllowed, messageConstructor$13, 405);
var messageConstructor$12 = ({ collection, field }) => {
  let message = "Value ";
  if (field) message += `for field "${field}" `;
  if (collection) message += `in collection "${collection}" `;
  message += `can't be null.`;
  return message;
};
var NotNullViolationError = createError(ErrorCode.NotNullViolation, messageConstructor$12, 400);
var OutOfDateError = createError(ErrorCode.OutOfDate, "Operation could not be executed: Your current instance of Directus is out of date.", 503);
var messageConstructor$11 = ({ range }) => {
  return `Range ${`"${range.start ?? ""}-${range.end ?? ""}"`} is invalid or the file's size doesn't match the requested range.`;
};
var RangeNotSatisfiableError = createError(ErrorCode.RangeNotSatisfiable, messageConstructor$11, 416);
var messageConstructor$10 = ({ collection, field, value }) => {
  let message = "Value ";
  if (value) message += `"${value}" `;
  if (field) message += `for field "${field}" `;
  if (collection) message += `in collection "${collection}" `;
  message += `has to be unique.`;
  return message;
};
var RecordNotUniqueError = createError(ErrorCode.RecordNotUnique, messageConstructor$10, 400);
var messageConstructor$9 = ({ path }) => `Route ${path} doesn't exist.`;
var RouteNotFoundError = createError(ErrorCode.RouteNotFound, messageConstructor$9, 404);
var messageConstructor$8 = ({ service, reason }) => `Service "${service}" is unavailable. ${reason}.`;
var ServiceUnavailableError = createError(ErrorCode.ServiceUnavailable, messageConstructor$8, 503);
var TokenExpiredError = createError(ErrorCode.TokenExpired, "Token expired.", 401);
var UnexpectedResponseError = createError(ErrorCode.UnexpectedResponse, "Received an unexpected response.", 503);
var messageConstructor$7 = (extensions) => `Can't process content. ${extensions.reason}.`;
var UnprocessableContentError = createError(ErrorCode.UnprocessableContent, messageConstructor$7, 422);
var messageConstructor$6 = (extensions) => `Unsupported media type "${extensions.mediaType}" in ${extensions.where}.`;
var UnsupportedMediaTypeError = createError(ErrorCode.UnsupportedMediaType, messageConstructor$6, 415);
var UserSuspendedError = createError(ErrorCode.UserSuspended, "User suspended.", 401);
var messageConstructor$5 = ({ collection, field, value }) => {
  let message = "Numeric value ";
  if (value) message += `"${value}" `;
  if (field) message += `for field "${field}" `;
  if (collection) message += `in collection "${collection}" `;
  message += `is out of range.`;
  return message;
};
var ValueOutOfRangeError = createError(ErrorCode.ValueOutOfRange, messageConstructor$5, 400);
var messageConstructor$4 = () => `Main item has changed since this version was last updated.`;
var VersionHashMismatchError = createError(ErrorCode.VersionHashMismatch, messageConstructor$4, 422);
var messageConstructor$3 = ({ collection, field, value }) => {
  let message = "Value ";
  if (value) message += `"${value}" `;
  if (field) message += `for field "${field}" `;
  if (collection) message += `in collection "${collection}" `;
  message += `is too long.`;
  return message;
};
var ValueTooLongError = createError(ErrorCode.ValueTooLong, messageConstructor$3, 400);
var messageConstructor$2 = ({ category, duration }) => `${category} timed out after ${(0, import_ms.default)(duration, { long: true })}.`;
var TimeoutError = createError(ErrorCode.OutOfTime, messageConstructor$2, 408);
var messageConstructor$1 = ({ action, source }) => `"${action}" is not allowed. ${source} license cannot be modified.`;
var LicenseImmutableError = createError(ErrorCode.InvalidPayload, messageConstructor$1, 409);
var messageConstructor = ({ category }) => {
  return `${category} is a restricted resource.`;
};
var ResourceRestrictedError = createError(ErrorCode.ResourceRestricted, messageConstructor, 403);

// src/index.ts
var REFERRAL_FIELDS = [
  "id",
  "partner",
  "referral_code",
  "service",
  "service_type",
  "status",
  "stage_date",
  "estimated_value",
  "source",
  "created_at",
  "updated_at"
];
var src_default = {
  id: "portal",
  handler(router, { database, logger }) {
    const getContext = async (req) => {
      const userId = req.accountability?.user;
      if (!userId) throw new ForbiddenError({ reason: "Autenticaci\xF3 requerida." });
      const user = await database("directus_users").select("id", "email", "role", "partner").where("id", userId).first();
      if (!user || !user.partner) {
        throw new ForbiddenError({ reason: "L'usuari no t\xE9 cap partner assignat." });
      }
      return user;
    };
    router.get("/me", async (req, res, next) => {
      try {
        const user = await getContext(req);
        const partner = await database("partners").where("id", user.partner).first();
        res.json({
          data: {
            user: { id: user.id, email: user.email, role: user.role },
            partner
          }
        });
      } catch (err) {
        next(err);
      }
    });
    router.get("/services", async (req, res, next) => {
      try {
        await getContext(req);
        const rows = await database("services").where("active", true).orderBy("name", "asc");
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });
    router.get("/referrals", async (req, res, next) => {
      try {
        const user = await getContext(req);
        const rows = await database("referrals").select(...REFERRAL_FIELDS).where("partner", user.partner).orderBy("created_at", "desc");
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });
    router.get("/referrals/:id", async (req, res, next) => {
      try {
        const user = await getContext(req);
        const row = await database("referrals").select(...REFERRAL_FIELDS).where({ id: req.params.id, partner: user.partner }).first();
        if (!row) throw new ForbiddenError({ reason: "Referit no trobat." });
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    });
    router.get("/referrals/:id/events", async (req, res, next) => {
      try {
        const user = await getContext(req);
        const rows = await database("referral_events as e").join("referrals as r", "r.id", "e.referral").select("e.id", "e.from_status", "e.to_status", "e.reason", "e.lost_reason", "e.created_at").where({ "r.id": req.params.id, "r.partner": user.partner }).orderBy("e.created_at", "asc");
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });
    router.post("/referrals", async (req, res, next) => {
      try {
        const user = await getContext(req);
        const body = req.body ?? {};
        const client_name = String(body.client_name ?? "").trim();
        const service = String(body.service ?? "").trim();
        if (!client_name || !service) {
          throw new InvalidPayloadError({ reason: "client_name i service s\xF3n obligatoris." });
        }
        const referral_code = `REF-${(0, import_node_crypto.randomBytes)(4).toString("hex").toUpperCase()}`;
        const [row] = await database("referrals").insert({
          partner: user.partner,
          referral_code,
          client_name,
          client_phone: body.client_phone ? String(body.client_phone) : null,
          client_email: body.client_email ? String(body.client_email) : null,
          client_address: body.client_address ? String(body.client_address) : null,
          service,
          service_type: body.service_type ? String(body.service_type) : null,
          notes: body.notes ? String(body.notes) : null,
          source: "portal",
          status: "lead"
        }).returning(...REFERRAL_FIELDS);
        logger.info(`[portal] referit creat ${referral_code} per partner ${user.partner}`);
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    });
    router.get("/wallet", async (req, res, next) => {
      try {
        const user = await getContext(req);
        const rows = await database("wallet_ledger").select("id", "type", "amount", "period", "status", "description", "created_at").where("partner", user.partner).orderBy("created_at", "desc");
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });
    router.post("/payouts", async (req, res, next) => {
      try {
        const user = await getContext(req);
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new InvalidPayloadError({ reason: "Quantitat no v\xE0lida." });
        }
        const [row] = await database("payouts").insert({ partner: user.partner, amount, status: "solicitada" }).returning("id", "amount", "status", "created_at");
        res.json({ data: row });
      } catch (err) {
        next(err);
      }
    });
    router.get("/documents", async (req, res, next) => {
      try {
        await getContext(req);
        const rows = await database("documents").select("id", "title", "type", "category", "file", "version", "updated_at").where("published", true).orderBy("updated_at", "desc");
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });
    router.get("/notifications", async (req, res, next) => {
      try {
        await getContext(req);
        const rows = await database("notifications").select("id", "title", "body", "image", "created_at").where("status", "sent").orderBy("created_at", "desc");
        res.json({ data: rows });
      } catch (err) {
        next(err);
      }
    });
  }
};
module.exports = module.exports.default;
