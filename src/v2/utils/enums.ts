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
