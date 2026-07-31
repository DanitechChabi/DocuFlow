import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { settingsService } from '../services/settingsService';

const SettingsContext = createContext({ site_name: 'DocuFlow', site_description: '' });

export const useSettings = () => useContext(SettingsContext);

const DEFAULT_TITLE = 'DocuFlow';
const DEFAULT_FAVICON = '/favicon.svg';

const applySiteName = (name) => {
  const title = name || DEFAULT_TITLE;
  document.title = `${title} — Plateforme de gestion documentaire`;
  document.querySelector('meta[name="application-name"]')?.setAttribute('content', title);
};

const applyLogo = (url) => {
  const href = url || DEFAULT_FAVICON;
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(el => {
    el.setAttribute('href', href);
  });
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    site_name: 'DocuFlow',
    site_description: '',
    site_logo: null,
    site_logo_url: null,
  });
  const [loaded, setLoaded] = useState(false);

  // Applique les paramètres au DOM (titre, favicon) à chaque changement
  useEffect(() => {
    applySiteName(settings.site_name);
    applyLogo(settings.site_logo_url);
  }, [settings.site_name, settings.site_logo_url]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await settingsService.getSettings();
        setSettings(prev => ({ ...prev, ...data }));
      } catch (err) {
        // Fallback silencieux
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await settingsService.getSettings();
      setSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      // Silent
    }
  }, []);

  const update = useCallback(async (data) => {
    await settingsService.updateSettings(data);
    await refresh();
  }, [refresh]);

  const uploadLogo = useCallback(async (file) => {
    const res = await settingsService.uploadLogo(file);
    await refresh();
    return res;
  }, [refresh]);

  return (
    <SettingsContext.Provider value={{ ...settings, loaded, refresh, update, uploadLogo }}>
      {children}
    </SettingsContext.Provider>
  );
};
