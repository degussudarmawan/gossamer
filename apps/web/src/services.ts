import { ApiClient } from './lib/ApiClient';
import { AuthApi } from './lib/AuthApi';
import { ThemeStore } from './lib/ThemeStore';

// The app's long-lived objects, built once and shared. Each backend area gets
// its own small API class on top of the one ApiClient.
const http = new ApiClient('/api');

export const authApi = new AuthApi(http);
export const themeStore = new ThemeStore();
