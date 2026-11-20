import { ProviderIcon, getProviderIconDef } from '@librechat/client';
import type { ProviderId } from 'librechat-data-provider';
import BaanzonMark from '~/components/ui/BaanzonMark';
import { cn } from '~/utils';

export function ResolvedProviderIcon({
  provider,
  imageURL,
  size = 20,
  className,
  model,
  alt = '',
}: {
  provider?: ProviderId | null;
  imageURL?: string | null;
  size?: number;
  className?: string;
  model?: string | null;
  alt?: string;
}) {
  if (imageURL) {
    return (
      <img
        src={imageURL}
        alt={alt}
        width={size}
        height={size}
        className={cn('object-contain', className)}
      />
    );
  }

  if (provider == null || getProviderIconDef(provider, model).label === 'Custom') {
    return <BaanzonMark className={cn('icon-sm', className)} />;
  }

  return <ProviderIcon provider={provider} model={model} size={size} className={className} />;
}
