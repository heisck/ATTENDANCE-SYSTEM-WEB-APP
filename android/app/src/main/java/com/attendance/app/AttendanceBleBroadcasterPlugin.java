package com.attendance.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.os.Build;
import android.os.ParcelUuid;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;

@CapacitorPlugin(
    name = "AttendanceBleBroadcaster",
    permissions = {
        @Permission(
            alias = "ble",
            strings = {
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            }
        )
    }
)
public class AttendanceBleBroadcasterPlugin extends Plugin {

    private BluetoothManager bluetoothManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeAdvertiser bluetoothLeAdvertiser;
    private BluetoothGattServer bluetoothGattServer;
    private BluetoothGattCharacteristic currentTokenCharacteristic;
    private BluetoothGattCharacteristic sessionMetaCharacteristic;
    private AttendanceBroadcastConfig activeConfig;
    private PluginCall pendingStartCall;
    private boolean starting = false;
    private boolean advertising = false;
    private String originalBluetoothName;
    private String lastError;
    private byte[] currentTokenValue = "{}".getBytes(StandardCharsets.UTF_8);
    private byte[] sessionMetaValue = "{}".getBytes(StandardCharsets.UTF_8);

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onCharacteristicReadRequest(
            BluetoothDevice device,
            int requestId,
            int offset,
            BluetoothGattCharacteristic characteristic
        ) {
            byte[] value = resolveCharacteristicValue(characteristic);
            if (bluetoothGattServer == null || value == null) {
                if (bluetoothGattServer != null) {
                    bluetoothGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null);
                }
                return;
            }

            if (offset < 0 || offset > value.length) {
                bluetoothGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null);
                return;
            }

            byte[] slicedValue = Arrays.copyOfRange(value, offset, value.length);
            bluetoothGattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, slicedValue);
        }
    };

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override
        public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            advertising = true;
            starting = false;
            lastError = null;
            resolvePendingStart();
        }

        @Override
        public void onStartFailure(int errorCode) {
            lastError = "BLE advertising failed to start (code " + errorCode + ").";
            advertising = false;
            starting = false;
            PluginCall failedCall = pendingStartCall;
            pendingStartCall = null;
            stopInternal(true);
            if (failedCall != null) {
                failedCall.reject(lastError);
            }
        }
    };

    @Override
    public void load() {
        super.load();
        bluetoothManager = (BluetoothManager) getContext().getSystemService(android.content.Context.BLUETOOTH_SERVICE);
        bluetoothAdapter = bluetoothManager != null ? bluetoothManager.getAdapter() : null;
        if (bluetoothAdapter != null) {
            bluetoothLeAdvertiser = bluetoothAdapter.getBluetoothLeAdvertiser();
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal(true);
        super.handleOnDestroy();
    }

    @PluginMethod
    public void startBroadcast(PluginCall call) {
        if (!isPlatformSupported()) {
            call.reject("This Android device does not support BLE peripheral advertising.");
            return;
        }

        if (requiresRuntimeBlePermission() && getPermissionState("ble") != PermissionState.GRANTED) {
            requestPermissionForAlias("ble", call, "handleStartBroadcastPermission");
            return;
        }

        startBroadcastInternal(call);
    }

    @PermissionCallback
    private void handleStartBroadcastPermission(PluginCall call) {
        if (requiresRuntimeBlePermission() && getPermissionState("ble") != PermissionState.GRANTED) {
            call.reject("Bluetooth advertise/connect permissions are required for attendance BLE.");
            return;
        }

        startBroadcastInternal(call);
    }

    @PluginMethod
    public void stopBroadcast(PluginCall call) {
        stopInternal(true);
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(buildStatus());
    }

    private synchronized void startBroadcastInternal(PluginCall call) {
        AttendanceBroadcastConfig config = AttendanceBroadcastConfig.fromCall(call);
        if (config == null) {
            call.reject("Broadcast payload is incomplete or invalid.");
            return;
        }

        currentTokenValue = config.currentTokenPayload.getBytes(StandardCharsets.UTF_8);
        sessionMetaValue = config.sessionMetaPayload.getBytes(StandardCharsets.UTF_8);

        if (!isBluetoothEnabled()) {
            call.reject("Bluetooth is turned off on this Android device.");
            return;
        }

        if (starting) {
            call.resolve(buildStatus());
            return;
        }

        if (isReusableActiveConfig(config)) {
            updateCharacteristicValues();
            lastError = null;
            call.resolve(buildStatus());
            return;
        }

        stopInternal(false);
        lastError = null;

        String setupError = prepareServerAndAdvertiser(config);
        if (setupError != null) {
            lastError = setupError;
            stopInternal(true);
            call.reject(setupError);
            return;
        }

        activeConfig = config;
        pendingStartCall = call;
        starting = true;

        bluetoothLeAdvertiser.startAdvertising(
            buildAdvertiseSettings(),
            buildAdvertiseData(config),
            buildScanResponse(),
            advertiseCallback
        );
    }

    @SuppressLint("MissingPermission")
    private String prepareServerAndAdvertiser(AttendanceBroadcastConfig config) {
        if (bluetoothManager == null || bluetoothAdapter == null) {
            return "Bluetooth manager is unavailable on this device.";
        }
        if (bluetoothLeAdvertiser == null) {
            return "Bluetooth LE advertiser is unavailable on this device.";
        }
        if (!bluetoothAdapter.isMultipleAdvertisementSupported()) {
            return "This Android device does not support multiple BLE advertisements.";
        }

        if (originalBluetoothName == null) {
            originalBluetoothName = bluetoothAdapter.getName();
        }
        try {
            bluetoothAdapter.setName(config.beaconName);
        } catch (SecurityException securityException) {
            return "Bluetooth name could not be updated for the attendance beacon.";
        }

        bluetoothGattServer = bluetoothManager.openGattServer(getContext(), gattServerCallback);
        if (bluetoothGattServer == null) {
            return "BLE GATT server could not be created.";
        }

        currentTokenCharacteristic =
            new BluetoothGattCharacteristic(
                config.currentTokenCharacteristicUuid,
                BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            );
        sessionMetaCharacteristic =
            new BluetoothGattCharacteristic(
                config.sessionMetaCharacteristicUuid,
                BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            );

        updateCharacteristicValues();

        BluetoothGattService service =
            new BluetoothGattService(config.serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        service.addCharacteristic(currentTokenCharacteristic);
        service.addCharacteristic(sessionMetaCharacteristic);

        boolean added = bluetoothGattServer.addService(service);
        if (!added) {
            return "Attendance BLE service could not be added to the Android GATT server.";
        }

        return null;
    }

    private AdvertiseSettings buildAdvertiseSettings() {
        return new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build();
    }

    private AdvertiseData buildAdvertiseData(AttendanceBroadcastConfig config) {
        return new AdvertiseData.Builder()
            .addServiceUuid(new ParcelUuid(config.serviceUuid))
            .setIncludeDeviceName(false)
            .build();
    }

    private AdvertiseData buildScanResponse() {
        return new AdvertiseData.Builder().setIncludeDeviceName(true).build();
    }

    private synchronized void updateCharacteristicValues() {
        if (currentTokenCharacteristic != null) {
            currentTokenCharacteristic.setValue(currentTokenValue);
        }
        if (sessionMetaCharacteristic != null) {
            sessionMetaCharacteristic.setValue(sessionMetaValue);
        }
    }

    private synchronized boolean isReusableActiveConfig(AttendanceBroadcastConfig config) {
        return advertising && activeConfig != null && activeConfig.canReuse(config);
    }

    private byte[] resolveCharacteristicValue(BluetoothGattCharacteristic characteristic) {
        if (activeConfig == null) {
            return null;
        }
        UUID requestedUuid = characteristic.getUuid();
        if (requestedUuid.equals(activeConfig.currentTokenCharacteristicUuid)) {
            return currentTokenValue;
        }
        if (requestedUuid.equals(activeConfig.sessionMetaCharacteristicUuid)) {
            return sessionMetaValue;
        }
        return null;
    }

    @SuppressLint("MissingPermission")
    private synchronized void stopInternal(boolean restoreBluetoothName) {
        starting = false;
        advertising = false;

        if (bluetoothLeAdvertiser != null) {
            try {
                bluetoothLeAdvertiser.stopAdvertising(advertiseCallback);
            } catch (Exception ignored) {
                // Best effort cleanup.
            }
        }

        if (bluetoothGattServer != null) {
            try {
                bluetoothGattServer.clearServices();
            } catch (Exception ignored) {
                // Best effort cleanup.
            }
            try {
                bluetoothGattServer.close();
            } catch (Exception ignored) {
                // Best effort cleanup.
            }
        }

        bluetoothGattServer = null;
        currentTokenCharacteristic = null;
        sessionMetaCharacteristic = null;
        activeConfig = null;

        if (restoreBluetoothName && bluetoothAdapter != null && originalBluetoothName != null) {
            try {
                bluetoothAdapter.setName(originalBluetoothName);
            } catch (Exception ignored) {
                // Best effort cleanup.
            }
            originalBluetoothName = null;
        }
        pendingStartCall = null;
    }

    private boolean isPlatformSupported() {
        return bluetoothAdapter != null && bluetoothLeAdvertiser != null;
    }

    private boolean requiresRuntimeBlePermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private boolean isBluetoothEnabled() {
        return bluetoothAdapter != null && bluetoothAdapter.isEnabled();
    }

    private synchronized void resolvePendingStart() {
        if (pendingStartCall == null) {
            return;
        }
        PluginCall call = pendingStartCall;
        pendingStartCall = null;
        call.resolve(buildStatus());
    }

    private synchronized void rejectPendingStart(String message) {
        if (pendingStartCall == null) {
            return;
        }
        PluginCall call = pendingStartCall;
        pendingStartCall = null;
        call.reject(message);
    }

    private JSObject buildStatus() {
        JSObject status = new JSObject();
        status.put("supported", isPlatformSupported());
        status.put("active", advertising && bluetoothGattServer != null);
        status.put("advertising", advertising);
        status.put("gattServerOpen", bluetoothGattServer != null);
        status.put("starting", starting);
        status.put("beaconName", activeConfig != null ? activeConfig.beaconName : null);
        status.put("deviceName", readAdapterNameSafely());
        status.put("serviceUuid", activeConfig != null ? activeConfig.serviceUuid.toString() : null);
        status.put("error", lastError);
        return status;
    }

    @SuppressLint("MissingPermission")
    private String readAdapterNameSafely() {
        if (bluetoothAdapter == null) {
            return null;
        }
        try {
            return bluetoothAdapter.getName();
        } catch (Exception ignored) {
            return null;
        }
    }

    private static final class AttendanceBroadcastConfig {
        final String beaconName;
        final UUID serviceUuid;
        final UUID currentTokenCharacteristicUuid;
        final UUID sessionMetaCharacteristicUuid;
        final String currentTokenPayload;
        final String sessionMetaPayload;

        AttendanceBroadcastConfig(
            String beaconName,
            UUID serviceUuid,
            UUID currentTokenCharacteristicUuid,
            UUID sessionMetaCharacteristicUuid,
            String currentTokenPayload,
            String sessionMetaPayload
        ) {
            this.beaconName = beaconName;
            this.serviceUuid = serviceUuid;
            this.currentTokenCharacteristicUuid = currentTokenCharacteristicUuid;
            this.sessionMetaCharacteristicUuid = sessionMetaCharacteristicUuid;
            this.currentTokenPayload = currentTokenPayload;
            this.sessionMetaPayload = sessionMetaPayload;
        }

        static AttendanceBroadcastConfig fromCall(PluginCall call) {
            String beaconName = call.getString("beaconName");
            String serviceUuidString = call.getString("serviceUuid");
            String currentTokenCharacteristicUuidString = call.getString("currentTokenCharacteristicUuid");
            String sessionMetaCharacteristicUuidString = call.getString("sessionMetaCharacteristicUuid");
            String currentTokenPayload = call.getString("currentTokenPayload");
            String sessionMetaPayload = call.getString("sessionMetaPayload");

            if (
                isBlank(beaconName) ||
                isBlank(serviceUuidString) ||
                isBlank(currentTokenCharacteristicUuidString) ||
                isBlank(sessionMetaCharacteristicUuidString) ||
                isBlank(currentTokenPayload) ||
                isBlank(sessionMetaPayload)
            ) {
                return null;
            }

            try {
                return new AttendanceBroadcastConfig(
                    beaconName.trim(),
                    UUID.fromString(serviceUuidString.trim()),
                    UUID.fromString(currentTokenCharacteristicUuidString.trim()),
                    UUID.fromString(sessionMetaCharacteristicUuidString.trim()),
                    currentTokenPayload,
                    sessionMetaPayload
                );
            } catch (IllegalArgumentException invalidUuid) {
                return null;
            }
        }

        boolean canReuse(AttendanceBroadcastConfig other) {
            return Objects.equals(beaconName, other.beaconName) &&
                Objects.equals(serviceUuid, other.serviceUuid) &&
                Objects.equals(currentTokenCharacteristicUuid, other.currentTokenCharacteristicUuid) &&
                Objects.equals(sessionMetaCharacteristicUuid, other.sessionMetaCharacteristicUuid);
        }

        private static boolean isBlank(String value) {
            return value == null || value.trim().isEmpty();
        }
    }
}
