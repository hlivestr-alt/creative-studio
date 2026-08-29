import { Check, Sparkles } from 'lucide-react';
import type { Product, ProductSelection } from '../domain/types';

const assetUrl = (path: string) => `proya-asset://${path.replaceAll('\\', '/')}`;

export function ProductCard({ product, selected, onSelect }: { product?: Product; selected: boolean; onSelect: (id: ProductSelection) => void }) {
  const id = product?.id ?? 'auto';
  return (
    <button className={`product-card ${selected ? 'selected' : ''}`} onClick={() => onSelect(id)} type="button" aria-pressed={selected}>
      <span className="product-visual">
        {product ? <img src={assetUrl(product.imagePath)} alt={product.shortName} /> : <span className="auto-orb"><Sparkles size={22} /></span>}
      </span>
      <span className="product-card-copy"><strong>{product?.shortName ?? 'Auto'}</strong><small>{product?.size ?? 'Smart rotation'}</small></span>
      {selected && <span className="selected-tick"><Check size={12} /></span>}
    </button>
  );
}
