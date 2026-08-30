package io.rootlens.mentra;

final class DeviceOperationGateTest {
    public static void main(String[] args) {
        DeviceOperationGate.release(DeviceOperationGate.Owner.CAPTURE);
        DeviceOperationGate.release(DeviceOperationGate.Owner.CALIBRATION);

        check(DeviceOperationGate.tryAcquire(DeviceOperationGate.Owner.CAPTURE));
        check(DeviceOperationGate.isOwnedBy(DeviceOperationGate.Owner.CAPTURE));
        check(!DeviceOperationGate.tryAcquire(DeviceOperationGate.Owner.CALIBRATION));
        DeviceOperationGate.release(DeviceOperationGate.Owner.CALIBRATION);
        check(DeviceOperationGate.isOwnedBy(DeviceOperationGate.Owner.CAPTURE));
        DeviceOperationGate.release(DeviceOperationGate.Owner.CAPTURE);

        check(DeviceOperationGate.tryAcquire(DeviceOperationGate.Owner.CALIBRATION));
        check(!DeviceOperationGate.tryAcquire(DeviceOperationGate.Owner.CAPTURE));
        DeviceOperationGate.release(DeviceOperationGate.Owner.CALIBRATION);
        check(DeviceOperationGate.owner() == DeviceOperationGate.Owner.NONE);
        System.out.println("DeviceOperationGate tests passed");
    }

    private static void check(boolean condition) {
        if (!condition) throw new AssertionError();
    }
}
