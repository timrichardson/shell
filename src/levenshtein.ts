export function distance(a: string, b: string): number {
    let distance: Array<Array<number>> = Array(b.length + 1);

    let i: number, j: number, indicator: 0 | 1;

    for (i = 0; i <= b.length + 1; i += 1) {
        distance[i] = Array(a.length + 1).fill(0);
    }

    for (i = 0; i <= a.length; i += 1) {
        distance[0][i] = i;
    }

    for (j = 0; j <= b.length; j += 1) {
        distance[j][0] = j;
    }

    for (j = 1; j <= b.length; j += 1) {
        for (i = 1; i <= a.length; i += 1) {
            indicator = a[i - 1] === b[j - 1] ? 0 : 1;
            distance[j][i] = Math.min(
                distance[j][i - 1] + 1,
                distance[j - 1][i] + 1,
                distance[j - 1][i - 1] + indicator,
            );
        }
    }

    return distance[b.length][a.length];
}
