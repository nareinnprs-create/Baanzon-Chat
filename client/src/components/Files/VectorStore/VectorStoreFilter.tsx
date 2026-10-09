import React from 'react';
import { useLocalize } from '~/hooks';

const VectorStoreFilter = () => {
  const localize = useLocalize();
  return <div>{localize('com_files_filter')}</div>;
};

export default VectorStoreFilter;
