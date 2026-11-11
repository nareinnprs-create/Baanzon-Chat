import { TMessage } from 'librechat-data-provider';
import { useAtomValue } from 'jotai';
import { densityCompact } from '~/store/settings';
import MessageQuotes from './MessageQuotes';
import SkillPills from './SkillPills';
import Files from './Files';

const Container = ({ children, message }: { children: React.ReactNode; message?: TMessage }) => {
  const compact = useAtomValue(densityCompact);
  return (
    <div
      className={`text-message flex min-h-[20px] flex-col items-start overflow-visible [.text-message+&]:mt-5 ${
        compact ? 'gap-2' : 'gap-3'
      }`}
      dir="auto"
    >
      {message?.isCreatedByUser === true && (
        <>
          <MessageQuotes quotes={message.quotes} />
          <Files message={message} />
          <SkillPills skills={message.alwaysAppliedSkills} source="always-apply" />
          <SkillPills skills={message.manualSkills} source="manual" />
        </>
      )}
      {children}
    </div>
  );
};

export default Container;
