import { Capacitor, registerPlugin } from "@capacitor/core";

export interface AttendanceBleBroadcasterStatus {
  supported: boolean;
  active: boolean;
  advertising: boolean;
  gattServerOpen: boolean;
  starting: boolean;
  beaconName: string | null;
  deviceName: string | null;
  serviceUuid: string | null;
  error?: string | null;
}

export interface AttendanceBleBroadcasterPlugin {
  startBroadcast(options: {
    beaconName: string;
    serviceUuid: string;
    currentTokenCharacteristicUuid: string;
    sessionMetaCharacteristicUuid: string;
    currentTokenPayload: string;
    sessionMetaPayload: string;
  }): Promise<AttendanceBleBroadcasterStatus>;
  stopBroadcast(): Promise<AttendanceBleBroadcasterStatus>;
  getStatus(): Promise<AttendanceBleBroadcasterStatus>;
}

export const AttendanceBleBroadcaster = registerPlugin<AttendanceBleBroadcasterPlugin>(
  "AttendanceBleBroadcaster"
);

export function isNativeAndroidBleBroadcasterAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}
