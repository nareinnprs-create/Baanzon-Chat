import { useEffect, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import * as Tabs from '@radix-ui/react-tabs';
import { GitCompare } from 'lucide-react';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react/unstyled';
import type { editor } from 'monaco-editor';
import { TooltipAnchor, Button } from '@librechat/client';
import type { Artifact } from '~/common';
import store from '~/store';
import { useGetSharedStartupConfig, useGetStartupConfig } from '~/data-provider';
import useArtifactProps from '~/hooks/Artifacts/useArtifactProps';
import useArtifacts from '~/hooks/Artifacts/useArtifacts';
import { ArtifactCodeEditor } from './ArtifactCodeEditor';
import ArtifactDiff from './ArtifactDiff';
import { useCodeState } from '~/Providers/EditorContext';
import { useLocalize } from '~/hooks';
import { ArtifactPreview } from './ArtifactPreview';
import { useShareContext } from '~/Providers';

export default function SandboxArtifactTabs({
  artifact,
  previewRef,
  isSharedConvo,
}: {
  artifact: Artifact;
  previewRef: React.MutableRefObject<SandpackPreviewRef>;
  isSharedConvo?: boolean;
}) {
  const localize = useLocalize();
  const { currentCode, setCurrentCode } = useCodeState();
  const { shareId } = useShareContext();
  const { orderedArtifactIds, currentIndex } = useArtifacts();
  const artifactsMap = useRecoilValue(store.artifactsState);
  /** X9: diff against the previous version snapshot, when one exists. */
  const previousContent =
    currentIndex > 0 ? artifactsMap?.[orderedArtifactIds[currentIndex - 1]]?.content : undefined;
  const [showDiff, setShowDiff] = useState(false);
  const shouldUseSharedConfig =
    isSharedConvo === true && typeof shareId === 'string' && shareId.length > 0;
  const { data: startupConfig } = useGetStartupConfig({ enabled: !shouldUseSharedConfig });
  const { data: sharedStartupConfig } = useGetSharedStartupConfig(shareId, {
    enabled: shouldUseSharedConfig,
  });
  const resolvedStartupConfig = shouldUseSharedConfig ? sharedStartupConfig : startupConfig;
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const lastIdRef = useRef<string | null>(null);

  /* The reset lands only after commit, so the render that switches artifacts
   * still sees the previous artifact's editor text. */
  const hasCurrentArtifactCode = lastIdRef.current === artifact.id;

  useEffect(() => {
    if (artifact.id !== lastIdRef.current) {
      setCurrentCode(undefined);
      setShowDiff(false);
    }
    lastIdRef.current = artifact.id;
  }, [artifact.id, setCurrentCode]);

  const { files, fileKey, template, sharedProps } = useArtifactProps({ artifact });

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs.Content
        value="code"
        id="artifacts-code"
        className="h-full w-full flex-grow overflow-auto"
        tabIndex={-1}
      >
        <div className="flex h-full w-full flex-col">
          {previousContent != null && (
            <div className="flex justify-end border-b border-border-light p-1">
              <TooltipAnchor
                description={localize('com_ui_diff_previous')}
                render={
                  <Button
                    size="sm"
                    variant={showDiff ? 'default' : 'ghost'}
                    onClick={() => setShowDiff((value) => !value)}
                    aria-label={localize('com_ui_diff_previous')}
                    aria-pressed={showDiff}
                  >
                    <GitCompare size={14} className="mr-1" aria-hidden="true" />
                    {localize('com_ui_diff_previous')}
                  </Button>
                }
              />
            </div>
          )}
          {showDiff && previousContent != null ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <ArtifactDiff previousContent={previousContent} currentContent={artifact.content} />
            </div>
          ) : (
            <ArtifactCodeEditor
              artifact={artifact}
              monacoRef={monacoRef}
              readOnly={isSharedConvo === true}
            />
          )}
        </div>
      </Tabs.Content>

      <Tabs.Content
        value="preview"
        className="h-full w-full flex-grow overflow-hidden"
        tabIndex={-1}
      >
        <ArtifactPreview
          files={files}
          fileKey={fileKey}
          template={template}
          previewRef={previewRef}
          sharedProps={sharedProps}
          currentCode={hasCurrentArtifactCode ? currentCode : undefined}
          startupConfig={resolvedStartupConfig}
        />
      </Tabs.Content>
    </div>
  );
}
