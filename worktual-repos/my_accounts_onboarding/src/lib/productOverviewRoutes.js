export function readProductKeyParam(params = {}) {
  return params["*"] || params.productKey || "";
}
