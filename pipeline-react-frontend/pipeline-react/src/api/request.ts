import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { message } from 'antd';
import { clearPersistedUserState, useUserStore } from '../stores/userStore';
import { handleDemoHttpRequest, isDemoModeActive } from './demo';

const TOKEN_ERROR_MESSAGE_RE = /(未登录|登录失效|登录超时|token|Token|TOKEN)/;

function logoutAndRedirect() {
  clearPersistedUserState();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

const request: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

request.interceptors.request.use(
  (config) => {
    if (typeof FormData !== 'undefined' && config.data instanceof FormData && config.headers) {
      delete config.headers['Content-Type'];
      delete config.headers['content-type'];
    }

    const token = useUserStore.getState().token;
    if (token) {
      config.headers.satoken = token;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

request.interceptors.response.use(
  (response: AxiosResponse) => {
    const res = response.data;
    const errorMessage = typeof res?.msg === 'string' ? res.msg : '请求失败';

    if (res.code !== 200) {
      message.error(errorMessage);

      if (res.code === 401 || TOKEN_ERROR_MESSAGE_RE.test(errorMessage)) {
        logoutAndRedirect();
      }

      return Promise.reject(new Error(errorMessage));
    }

    return res;
  },
  (error) => {
    console.error('请求错误:', error);

    const responseMessage =
      typeof error?.response?.data?.msg === 'string' ? error.response.data.msg : '';

    if (error.response) {
      switch (error.response.status) {
        case 401:
          message.error('登录已过期，请重新登录');
          logoutAndRedirect();
          break;
        case 403:
          message.error('没有权限访问');
          break;
        case 404:
          message.error('请求的资源不存在');
          break;
        case 500:
          if (TOKEN_ERROR_MESSAGE_RE.test(responseMessage)) {
            message.error(responseMessage);
            logoutAndRedirect();
          } else {
            message.error('服务器内部错误');
          }
          break;
        default:
          if (TOKEN_ERROR_MESSAGE_RE.test(responseMessage)) {
            message.error(responseMessage);
            logoutAndRedirect();
          } else {
            message.error(error.message || '网络错误');
          }
      }
    } else {
      message.error('网络连接失败');
    }

    return Promise.reject(error);
  }
);

export const http = {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    if (isDemoModeActive()) {
      return handleDemoHttpRequest<T>('GET', url, undefined, config);
    }
    return request.get(url, config);
  },

  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    if (isDemoModeActive()) {
      return handleDemoHttpRequest<T>('POST', url, data, config);
    }
    return request.post(url, data, config);
  },

  put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    if (isDemoModeActive()) {
      return handleDemoHttpRequest<T>('PUT', url, data, config);
    }
    return request.put(url, data, config);
  },

  delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    if (isDemoModeActive()) {
      return handleDemoHttpRequest<T>('DELETE', url, undefined, config);
    }
    return request.delete(url, config);
  },
};

export default request;
