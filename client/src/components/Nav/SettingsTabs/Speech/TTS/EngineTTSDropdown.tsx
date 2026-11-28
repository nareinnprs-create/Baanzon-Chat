import React from 'react';
import { Dropdown } from '@librechat/client';
import { useRecoilState, useRecoilValue } from 'recoil';
import { useLocalize } from '~/hooks';
import store from '~/store';

interface EngineTTSDropdownProps {
  external: boolean;
}

const EngineTTSDropdown: React.FC<EngineTTSDropdownProps> = ({ external }) => {
  const localize = useLocalize();
  const [engineTTS, setEngineTTS] = useRecoilState<string>(store.engineTTS);
  const textToSpeech = useRecoilValue(store.textToSpeech);

  const endpointOptions = [
    { value: 'server', label: localize('com_nav_server_voice') },
    { value: 'browser', label: localize('com_nav_browser') },
    ...(external ? [{ value: 'external', label: localize('com_nav_external') }] : []),
  ];

  const handleSelect = (value: string) => {
    setEngineTTS(value);
  };

  const labelId = 'engine-tts-dropdown-label';

  return (
    <div className="flex items-center justify-between">
      <div id={labelId}>{localize('com_nav_engine')}</div>
      <Dropdown
        value={engineTTS}
        onChange={handleSelect}
        options={endpointOptions}
        sizeClasses="z-50 w-[180px]"
        testId="EngineTTSDropdown"
        className="z-50"
        aria-labelledby={labelId}
        disabled={!textToSpeech}
      />
    </div>
  );
};

export default EngineTTSDropdown;
