import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';
import { ConfigProvider } from 'antd';
import App from './App';
import { LOGO_URL } from './brand';
import { store } from './store';
import './styles.css';

const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
if (favicon) {
  favicon.href = LOGO_URL;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider
          theme={{
            token: { colorPrimary: '#2563eb', borderRadius: 8 },
          }}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConfigProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>,
);
