// A category as shown to customers (CategoryService).
export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
}
