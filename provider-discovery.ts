import { NANOGPT_PROVIDER_ID, NANOGPT_PROVIDER_LABEL, NANOGPT_DOCS_PATH } from "./models.js";
import { nanoGptProviderCatalog } from "./provider-catalog.js";

const nanoGptProviderDiscovery = {
  id: NANOGPT_PROVIDER_ID,
  label: NANOGPT_PROVIDER_LABEL,
  docsPath: NANOGPT_DOCS_PATH,
  auth: [],
  catalog: nanoGptProviderCatalog,
};

export default nanoGptProviderDiscovery;
