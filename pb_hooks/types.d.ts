/**
 * Stub de tipus JSVM de PocketBase per a suport d'editor.
 * (Els fitxers de hooks es carreguen amb goja al runtime; aquest fitxer
 * només ajuda l'IDE. Es pot regenerar des de la referència oficial.)
 */
declare const $app: any
declare const $os: any
declare const $security: any
declare const $http: any
declare const $dbx: any
declare const $apis: any
declare function routerAdd(method: string, path: string, handler: any, ...middlewares: any[]): void
declare function routerUse(middleware: any): void
declare function onBootstrap(handler: any): void
declare function onRecordCreate(handler: any, ...collections: string[]): void
declare function onRecordUpdate(handler: any, ...collections: string[]): void
declare function onRecordCreateRequest(handler: any, ...collections: string[]): void
declare function onRecordUpdateRequest(handler: any, ...collections: string[]): void
declare function onRecordDeleteRequest(handler: any, ...collections: string[]): void
declare function onRecordAfterCreateSuccess(handler: any, ...collections: string[]): void
declare function onRecordAfterUpdateSuccess(handler: any, ...collections: string[]): void
declare function onRecordEnrich(handler: any, ...collections: string[]): void
declare function cronAdd(id: string, expr: string, handler: () => void): void
declare function cronRemove(id: string): void
declare function migrate(up: (app: any) => void, down?: (app: any) => void): void
declare class Collection { constructor(def?: any); id: string; name: string; type: string }
declare class Record { constructor(collection?: any); id: string; get(f: string): any; set(f: string, v: any): void; collection(): any; original(): any; hide(...f: string[]): void; newAuthToken(): string; email(): string; publicExport(): any }
declare class MailerMessage { constructor(opts: any); subject: string }
declare class DynamicModel { constructor(def?: any); get(k: string): any }
declare class ForbiddenError extends Error { constructor(msg?: string) }
declare class BadRequestError extends Error { constructor(msg?: string) }
declare class UnauthorizedError extends Error { constructor(msg?: string) }
