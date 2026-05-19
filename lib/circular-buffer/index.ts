export class CircularBuffer<T> {
  private readonly capacity: number;
  private readonly entries: T[];
  private head: number;
  private count: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.entries = [];
    this.head = 0;
    this.count = 0;
  }

  append(item: T): void {
    this.entries[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count += 1;
    }
  }

  /** Returns all entries in insertion order (oldest first). */
  read(): T[] {
    const start = this.count < this.capacity ? 0 : this.head;
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.entries[(start + i) % this.capacity]);
    }
    return result;
  }

  get size(): number {
    return this.count;
  }
}
