export enum ECypressCommand {
  VISIT = "visit",
  GET = "get",
  FIND = "find",
  CONTAINS = "contains",
  INTERCEPT = "intercept",
  URL = "url",
}

export enum EHttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
}

export enum ETestBlockType {
  DESCRIBE = "describe",
  IT = "it",
  CONTEXT = "context",
}

export enum ESelectorAttr {
  TEST_ID = "data-testid",
  DATA_CY = "data-cy",
  ID = "id",
  ARIA_LABEL = "aria-label",
  CLASS = "class",
  COMPLEX = "complex",
}

export enum EReactRouter {
  PATH = "path",
  ELEMENT = "element",
}

export enum EReactComponent {
  ROUTE = "Route",
}

export enum ERedux {
  NAME = "name",
}

export enum EFunctionCall {
  T = "t",
  USE_SELECTOR = "useSelector",
  DISPATCH = "dispatch",
  CREATE_SELECTOR = "createSelector",
  CREATE_SLICE = "createSlice",
  CREATE_ACTION = "createAction",
}

export enum EAssertionType {
  SHOULD = "should",
}

export enum EReduxRole {
  ACTIONS = "actions",
  REDUCER = "reducer",
  SELECTORS = "selectors",
  SAGAS = "sagas",
  SLICE = "slice",
  TYPES = "types",
  UNKNOWN = "unknown",
}

export enum EAnalyzerName {
  SOURCE_EXTRACTOR = "source-extractor",
  CYPRESS_EXTRACTOR = "cypress-extractor",
  REDUX_CHAIN_ANALYZER = "redux-chain-analyzer",
  I18N_ANALYZER = "i18n-analyzer",
}

export enum EConfidenceLevel {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

export enum EScorerType {
  DIRECT_IMPORT = "direct-import",
  ROUTE_MATCH = "route-match",
  SELECTOR_MATCH = "selector-match",
}
