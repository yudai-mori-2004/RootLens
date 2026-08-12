package io.rootlens.mentra;

import java.util.Arrays;

final class PrimitiveLongList {
    private long[] values = new long[4096];
    private int size;

    synchronized int add(long value) {
        if (size == values.length) {
            values = Arrays.copyOf(values, values.length * 2);
        }
        values[size] = value;
        return size++;
    }

    synchronized int size() {
        return size;
    }

    synchronized long get(int index) {
        return values[index];
    }

    synchronized int floorIndex(long target) {
        if (size == 0 || target < values[0]) return -1;
        int low = 0;
        int high = size - 1;
        while (low <= high) {
            int mid = (low + high) >>> 1;
            long value = values[mid];
            if (value <= target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return high;
    }
}
