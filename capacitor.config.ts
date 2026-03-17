import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.attendance.app',
  appName: 'Attendance App',
  webDir: 'out',
  server: {
    url: 'http://10.55.5.178:3000',
    cleartext: true
  }
};

export default config;
