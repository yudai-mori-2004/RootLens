package io.rootlens.mentra;

/** Process-local ownership gate for the one physical camera/IMU capture path. */
final class DeviceOperationGate {
    enum Owner { NONE, CAPTURE, CALIBRATION }

    private static Owner owner = Owner.NONE;

    static synchronized boolean tryAcquire(Owner requested) {
        if (requested == Owner.NONE) throw new IllegalArgumentException("NONE cannot acquire");
        if (owner != Owner.NONE) return owner == requested;
        owner = requested;
        return true;
    }

    static synchronized boolean isOwnedBy(Owner expected) {
        return owner == expected;
    }

    static synchronized Owner owner() {
        return owner;
    }

    static synchronized void release(Owner expected) {
        if (owner == expected) owner = Owner.NONE;
    }

    private DeviceOperationGate() {}
}
