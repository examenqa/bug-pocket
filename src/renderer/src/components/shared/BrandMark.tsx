import brandSvg from '../../assets/bug-pocket-brand.svg?raw';

interface BrandMarkProps {
  className?: string;
  label?: string;
}

export function BrandMark({ className = '', label = 'Bug Pocket' }: BrandMarkProps) {
  return (
    <span
      className={className ? `brand-mark ${className}` : 'brand-mark'}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: brandSvg }}
    />
  );
}
