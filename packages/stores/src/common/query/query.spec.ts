import { ObservableQuery } from "./index";
import { KVStore, MemoryKVStore } from "@keplr-wallet/common";
import Axios from "axios";
import Http from "http";
import { autorun } from "mobx";

export class MockObservableQuery extends ObservableQuery<number> {
  constructor(kvStore: KVStore, port: number) {
    const instance = Axios.create({
      baseURL: `http://127.0.0.1:${port}`,
    });

    super(kvStore, instance, "/test");
  }
}

export class DelayMemoryKVStore extends MemoryKVStore {
  constructor(prefix: string, public readonly delay: number) {
    super(prefix);
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await new Promise((resolve) => {
      setTimeout(resolve, this.delay);
    });

    return super.get(key);
  }

  async set<T = unknown>(key: string, data: T | null): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, this.delay);
    });

    return super.set(key, data);
  }
}

describe("Test observable query", () => {
  const createTestServer = (delay: number = 100) => {
    let num = 0;
    let cancelCount = 0;

    const server = Http.createServer((req, resp) => {
      let fulfilled = false;
      let closed = false;
      req.once("close", () => {
        if (!fulfilled) {
          cancelCount++;
        }
        closed = true;
      });
      setTimeout(() => {
        if (!closed) {
          resp.writeHead(200);
          resp.end(num.toString());

          num++;
        }
        fulfilled = true;
      }, delay);
    });

    server.listen();

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to get address for server");
    }
    const port = address.port;

    return {
      port,
      closeServer: () => {
        server.close();
      },
      getServerCancelCount: () => cancelCount,
    };
  };

  it("basic test", async () => {
    const basicTestFn = async (store: KVStore) => {
      const { port, closeServer, getServerCancelCount } = createTestServer();

      const query = new MockObservableQuery(store, port);

      // Nothing is being fetched because no value has been observed
      expect(query.isObserved).toBe(false);
      expect(query.isFetching).toBe(false);
      expect(query.isStarted).toBe(false);
      expect(query.error).toBeUndefined();
      expect(query.response).toBeUndefined();

      const disposer = autorun(
        () => {
          // This makes the response observed. Thus, fetching starts.
          if (query.response) {
            expect(query.response.data).toBe(0);
          }
        },
        {
          onError: (e) => {
            throw e;
          },
        }
      );

      // Above code make query starts, but the response not yet fetched
      expect(query.isObserved).toBe(true);
      expect(query.isFetching).toBe(true);
      expect(query.isStarted).toBe(true);
      expect(query.error).toBeUndefined();
      expect(query.response).toBeUndefined();

      // Make sure that the fetching complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Not yet observer disposed. So the query is still in observation.
      expect(query.isObserved).toBe(true);
      expect(query.isFetching).toBe(false);
      expect(query.isStarted).toBe(true);
      expect(query.error).toBeUndefined();
      expect(query.response).not.toBeUndefined();
      expect(query.response?.data).toBe(0);

      disposer();
      // Not, the observation ends
      expect(query.isObserved).toBe(false);
      expect(query.isFetching).toBe(false);
      expect(query.isStarted).toBe(false);
      expect(query.error).toBeUndefined();
      expect(query.response).not.toBeUndefined();
      expect(query.response?.data).toBe(0);

      await query.waitResponse();
      expect(query.response?.data).toBe(0);

      await query.waitFreshResponse();
      expect(query.response?.data).toBe(1);

      expect(getServerCancelCount()).toBe(0);

      closeServer();
    };

    const memStore = new DelayMemoryKVStore("test", 1);
    await basicTestFn(memStore);

    // The kvstore below has a delay of 3 seconds.
    // This is definitely slower than the query.
    // Even if the kvstore performs worse than the query, it should handle it well.
    const delayMemStore = new DelayMemoryKVStore("test", 3000);
    await basicTestFn(delayMemStore);
  });

  it("test waitResponse() can ignore other component unobserved", async () => {
    const { port, closeServer, getServerCancelCount } = createTestServer(500);

    const memStore = new MemoryKVStore("test");
    const query = new MockObservableQuery(memStore, port);

    const disposer = autorun(
      () => {
        if (query.response) {
          throw new Error("not canceled");
        }
      },
      {
        onError: (e) => {
          throw e;
        },
      }
    );

    setTimeout(() => {
      disposer();
    }, 200);

    const res = await query.waitResponse();
    expect(res?.data).toBe(0);

    expect(getServerCancelCount()).toBe(0);

    closeServer();
  });

  it("test waitResponse() can ignore fetch requests", async () => {
    const { port, closeServer, getServerCancelCount } = createTestServer(500);

    const memStore = new MemoryKVStore("test");
    const query = new MockObservableQuery(memStore, port);

    const disposer = autorun(
      () => {
        // This makes the response observed. Thus, fetching starts.
        if (query.response && query.response.data !== 0) {
          throw new Error("not canceled");
        }
      },
      {
        onError: (e) => {
          throw e;
        },
      }
    );

    // Below line makes cancel and refresh
    setTimeout(() => {
      query.fetch();
    }, 10);

    const res = await query.waitResponse();
    expect(res?.data).toBe(0);

    expect(getServerCancelCount()).toBe(1);

    disposer();

    closeServer();
  });

  it("test waitFreshResponse() can ignore other component unobserved", async () => {
    const { port, closeServer, getServerCancelCount } = createTestServer(500);

    const memStore = new MemoryKVStore("test");
    const query = new MockObservableQuery(memStore, port);

    await query.waitFreshResponse();

    const disposer = autorun(
      () => {
        if (query.response?.data !== 0) {
          throw new Error("not canceled");
        }
      },
      {
        onError: (e) => {
          throw e;
        },
      }
    );

    setTimeout(() => {
      disposer();
    }, 200);

    const res = await query.waitFreshResponse();
    expect(res?.data).toBe(1);

    expect(getServerCancelCount()).toBe(0);

    closeServer();
  });

  it("test waitFreshResponse() can ignore fetch requests", async () => {
    const { port, closeServer, getServerCancelCount } = createTestServer(500);

    const memStore = new MemoryKVStore("test");
    const query = new MockObservableQuery(memStore, port);

    await query.waitFreshResponse();

    const disposer = autorun(
      () => {
        // This makes the response observed. Thus, fetching starts.
        if (query.response?.data !== 0 && query.response?.data !== 1) {
          throw new Error("not canceled");
        }
      },
      {
        onError: (e) => {
          throw e;
        },
      }
    );

    // Below line makes cancel and refresh
    setTimeout(() => {
      query.fetch();
    }, 10);

    const res = await query.waitFreshResponse();
    expect(res?.data).toBe(1);

    expect(getServerCancelCount()).toBe(1);

    disposer();

    closeServer();
  });

  it("test waitFreshResponse()/waitFreshResponse()", async () => {
    const { port, closeServer, getServerCancelCount } = createTestServer();

    const memStore = new MemoryKVStore("test");
    const query = new MockObservableQuery(memStore, port);

    let res = await query.waitResponse();
    expect(res?.data).toBe(0);

    res = await query.waitFreshResponse();
    expect(res?.data).toBe(1);

    res = await query.waitResponse();
    expect(res?.data).toBe(1);

    res = await query.waitFreshResponse();
    expect(res?.data).toBe(2);

    expect(getServerCancelCount()).toBe(0);

    closeServer();
  });

  it("test basic cancellation", async () => {
    const { port, closeServer, getServerCancelCount } = createTestServer(500);

    const memStore = new MemoryKVStore("test");
    const query = new MockObservableQuery(memStore, port);

    expect(query.isObserved).toBe(false);
    expect(query.isFetching).toBe(false);
    expect(query.isStarted).toBe(false);
    expect(query.error).toBeUndefined();
    expect(query.response).toBeUndefined();

    const disposer = autorun(
      () => {
        // This makes the response observed. Thus, fetching starts.
        if (query.response) {
          throw new Error("not canceled");
        }
      },
      {
        onError: (e) => {
          throw e;
        },
      }
    );

    expect(query.isObserved).toBe(true);
    expect(query.isFetching).toBe(true);
    expect(query.isStarted).toBe(true);
    expect(query.error).toBeUndefined();
    expect(query.response).toBeUndefined();

    // Dispose the observer before the fetch completes.
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        disposer();
        resolve();
      }, 100);
    });

    // Wait to close request.
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    // In this case, query should be canceled.
    expect(query.isObserved).toBe(false);
    expect(query.isFetching).toBe(false);
    expect(query.isStarted).toBe(false);
    // Cancellation should not make the error.
    expect(query.error).toBeUndefined();
    expect(query.response).toBeUndefined();

    expect(getServerCancelCount()).toBe(1);

    closeServer();
  });
});
