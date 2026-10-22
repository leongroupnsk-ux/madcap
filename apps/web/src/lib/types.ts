export type Dictionaries = {
  categories: { id: string; name: string; slug: string; parentId: string | null; slot: string | null }[];
  colors: { id: string; name: string; hex: string }[];
  specialtyGroups: { id: string; name: string; specialties: { id: string; name: string }[] }[];
  brands: { id: string; name: string; slug: string }[];
};

export type SupplierMe = {
  user: { id: string; email: string; totpEnabled: boolean };
  role: 'owner' | 'catalog' | 'warehouse';
  supplier: {
    id: string; legalName: string; inn: string; status: string; payoutStatus: 'not_connected' | 'in_review' | 'active';
    commissionBp: number; description: string; warehouseAddress: string; cdekCityCode: number | null; shipDays: number; cdekShipmentPoint?: string; ymlFeedUrl: string | null;
  };
};

export type Media = { id: string; type: 'photo' | 'video'; url: string; thumbUrl: string | null; posterUrl: string | null; isMain: boolean; approved: boolean; durationS: number | null };

export type Variant = {
  id?: string; sku: string; size: string; heightRange: string | null; colorId: string; price: number; oldPrice: number | null;
  stock: number; weightG: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null;
};

export type Product = {
  id: string; slug: string; title: string; brandId: string; categoryId: string; gender: 'female' | 'male' | 'unisex';
  fabric: string; treatment: string; washing: string; description: string; specialtyIds: string[];
  moderationStatus: 'draft' | 'pending' | 'published' | 'rejected' | 'hidden'; rejectReason: string | null;
  source: 'manual' | 'file' | 'yml'; manualOverride: boolean; externalId: string | null; createdAt: string; updatedAt: string;
  revision: { id: string; status: 'pending' | 'rejected'; rejectReason: string | null; createdAt: string } | null;
  variants: Variant[]; media: Media[];
};

export type ImportJob = {
  id: string; source: 'file' | 'yml'; fileName: string | null; status: 'queued' | 'checking' | 'checked' | 'applying' | 'applied' | 'failed';
  totalRows: number; newProducts: number; updates: number; errorRows: number; failReason: string | null;
  createdAt: string; checkedAt: string | null; appliedAt: string | null; errors: { row: number; field: string; message: string }[];
};
