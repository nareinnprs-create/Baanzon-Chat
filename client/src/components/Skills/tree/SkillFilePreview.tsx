import { Button } from '@librechat/client';
import { apiBaseUrl } from 'librechat-data-provider';
import { Download, FileQuestion } from 'lucide-react';
import { SKILL_TREE_LABELS } from './labels';
import { useLocalize } from '~/hooks';

/**
 * Fallback for nodes the text editor cannot open: binaries the tree content
 * route rejects with 415, and files over the inline limit (413). The raw
 * download uses the phase-1 files route, which streams any file type.
 */
interface SkillFilePreviewProps {
  skillId: string;
  nodeId: string;
  fileName: string;
  reason: 'binary' | 'too-large';
}

export default function SkillFilePreview({
  skillId,
  nodeId,
  fileName,
  reason,
}: SkillFilePreviewProps) {
  const localize = useLocalize();
  const downloadUrl = `${apiBaseUrl()}/api/skills/${encodeURIComponent(
    skillId,
  )}/files/${encodeURIComponent(nodeId)}`;
  const message =
    reason === 'binary'
      ? localize('com_ui_skill_file_binary')
      : localize(SKILL_TREE_LABELS.tooLarge);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-text-secondary">
      <FileQuestion className="size-8" aria-hidden="true" />
      <p className="text-sm">{message}</p>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" asChild>
        <a
          href={downloadUrl}
          download={fileName}
          aria-label={`${localize('com_ui_download')} ${fileName}`}
        >
          <Download className="size-3.5" aria-hidden="true" />
          {localize('com_ui_download')}
        </a>
      </Button>
    </div>
  );
}
