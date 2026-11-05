import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text } from '@forge/react';
import { invoke } from '@forge/bridge';

// Confluence-side module. It makes one call as the viewing user. If that user has not yet allowed Same Page to act for them in
// Confluence, the call throws uncaught and the platform shows its "allow access" prompt right here; after that, the Jira panel can
// read linked pages as the same user.
const Byline = () => {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { void invoke('confluenceCheck').then(() => setOk(true)).catch(() => setOk(false)); }, []);
  return <Text>{ok === null ? 'Same Page is checking access…' : ok ? 'Same Page can read this site as you.' : 'Same Page could not reach Confluence.'}</Text>;
};

ForgeReconciler.render(<React.StrictMode><Byline /></React.StrictMode>);
