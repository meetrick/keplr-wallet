import { ChainsService } from "../chains";
import { KeyRingCosmosService } from "../keyring-cosmos";
import { KeyRingService } from "../keyring";
import { ChainsUIService } from "../chains-ui";
import { autorun, makeObservable, observable, runInAction, toJS } from "mobx";
import { AppCurrency } from "@keplr-wallet/types";
import { simpleFetch } from "@keplr-wallet/simple-fetch";
import { Dec } from "@keplr-wallet/unit";
import { ChainIdHelper } from "@keplr-wallet/cosmos";
import { VaultService } from "../vault";
import { KVStore } from "@keplr-wallet/common";
import { KeyRingStarknetService } from "../keyring-starknet";
import { CairoUint256 } from "starknet";

export type TokenScan = {
  chainId: string;
  infos: {
    bech32Address?: string;
    ethereumHexAddress?: string;
    starknetHexAddress?: string;
    coinType?: number;
    assets: {
      currency: AppCurrency;
      amount: string;
    }[];
  }[];
};

export class TokenScanService {
  @observable
  protected vaultToMap = new Map<string, TokenScan[]>();

  constructor(
    protected readonly kvStore: KVStore,
    protected readonly chainsService: ChainsService,
    protected readonly chainsUIService: ChainsUIService,
    protected readonly vaultService: VaultService,
    protected readonly keyRingService: KeyRingService,
    protected readonly keyRingCosmosService: KeyRingCosmosService,
    protected readonly keyRingStarknetService: KeyRingStarknetService
  ) {
    makeObservable(this);
  }

  async init(): Promise<void> {
    const saved = await this.kvStore.get<Record<string, TokenScan[]>>(
      "vaultToMap"
    );
    if (saved) {
      runInAction(() => {
        for (const [key, value] of Object.entries(saved)) {
          this.vaultToMap.set(key, value);
        }
      });
    }
    autorun(() => {
      const js = toJS(this.vaultToMap);
      const obj = Object.fromEntries(js);
      this.kvStore.set("vaultToMap", obj);
    });

    this.vaultService.addVaultRemovedHandler(
      (type: string, vaultId: string) => {
        if (type === "keyRing") {
          this.vaultToMap.delete(vaultId);
        }
      }
    );
    this.chainsService.addChainSuggestedHandler(async (chainInfo) => {
      await this.scanWithAllVaults(chainInfo.chainId);
    });
    this.chainsUIService.addChainUIEnabledChangedHandler(
      (vaultId, chainIdentifiers) => {
        runInAction(() => {
          let prevTokenScans = this.vaultToMap.get(vaultId);
          if (prevTokenScans) {
            prevTokenScans = prevTokenScans.filter((tokenScan) => {
              return !chainIdentifiers.includes(
                ChainIdHelper.parse(tokenScan.chainId).identifier
              );
            });
            this.vaultToMap.set(vaultId, prevTokenScans);
          }
        });
      }
    );
  }

  getTokenScans(vaultId: string): TokenScan[] {
    return (this.vaultToMap.get(vaultId) ?? []).sort((a, b) => {
      // Sort by chain name
      const aChainInfo = this.chainsService.hasChainInfo(a.chainId)
        ? this.chainsService.getChainInfoOrThrow(a.chainId)
        : this.chainsService.getModularChainInfoOrThrow(a.chainId);
      const bModualrChainInfo = this.chainsService.hasChainInfo(b.chainId)
        ? this.chainsService.getChainInfoOrThrow(b.chainId)
        : this.chainsService.getModularChainInfoOrThrow(b.chainId);

      return aChainInfo.chainName.localeCompare(bModualrChainInfo.chainName);
    });
  }

  protected async scanWithAllVaults(chainId: string): Promise<void> {
    if (this.keyRingService.keyRingStatus !== "unlocked") {
      return;
    }

    const chainInfo = this.chainsService.getChainInfoOrThrow(chainId);
    if (chainInfo.hideInUI) {
      return;
    }

    const vaultIds = this.keyRingService
      .getKeyInfos()
      .map((keyInfo) => keyInfo.id)
      .sort((a, b) => {
        // 현재 선택된 계정에게 우선권을 준다.
        const aIsSelected = this.keyRingService.selectedVaultId === a;
        const bIsSelected = this.keyRingService.selectedVaultId === b;

        if (aIsSelected) {
          return -1;
        }
        if (bIsSelected) {
          return 1;
        }
        return 0;
      });
    for (const vaultId of vaultIds) {
      // 얘는 계정 수를 예상하기 힘드니까 그냥 순차적으로 한다...
      await this.scan(vaultId, chainId);
    }
  }

  async scan(vaultId: string, chainId: string): Promise<void> {
    if (this.keyRingService.keyRingStatus !== "unlocked") {
      return;
    }

    const chainInfo = this.chainsService.getChainInfoOrThrow(chainId);
    if (chainInfo.hideInUI) {
      return;
    }

    const tokenScan = await this.calculateTokenScan(vaultId, chainId);

    if (tokenScan) {
      if (this.chainsUIService.isEnabled(vaultId, tokenScan.chainId)) {
        return;
      }

      runInAction(() => {
        let prevTokenScans = this.vaultToMap.get(vaultId) ?? [];

        const chainIdentifier = ChainIdHelper.parse(
          tokenScan.chainId
        ).identifier;
        prevTokenScans = prevTokenScans.filter((scan) => {
          const prevChainIdentifier = ChainIdHelper.parse(
            scan.chainId
          ).identifier;
          return chainIdentifier !== prevChainIdentifier;
        });

        prevTokenScans.push(tokenScan);

        this.vaultToMap.set(vaultId, prevTokenScans);
      });
    }
  }

  async scanAll(vaultId: string): Promise<void> {
    if (this.keyRingService.keyRingStatus !== "unlocked") {
      return;
    }

    const modularChainInfos = this.chainsService
      .getModularChainInfos()
      .filter(
        (chainInfo) =>
          !this.chainsUIService.isEnabled(vaultId, chainInfo.chainId)
      );

    const tokenScans: TokenScan[] = [];
    const promises: Promise<void>[] = [];
    for (const modularChainInfo of modularChainInfos) {
      promises.push(
        (async () => {
          const tokenScan = await this.calculateTokenScan(
            vaultId,
            modularChainInfo.chainId
          );

          if (tokenScan) {
            tokenScans.push(tokenScan);
          }
        })()
      );
    }

    // ignore error
    await Promise.allSettled(promises);

    if (tokenScans.length > 0) {
      runInAction(() => {
        let prevTokenScans = this.vaultToMap.get(vaultId) ?? [];

        for (const tokenScan of tokenScans) {
          const chainIdentifier = ChainIdHelper.parse(
            tokenScan.chainId
          ).identifier;
          prevTokenScans = prevTokenScans.filter((scan) => {
            const prevChainIdentifier = ChainIdHelper.parse(
              scan.chainId
            ).identifier;
            return chainIdentifier !== prevChainIdentifier;
          });

          prevTokenScans.push(tokenScan);
        }

        prevTokenScans = prevTokenScans.filter((scan) => {
          return !this.chainsUIService.isEnabled(vaultId, scan.chainId);
        });

        this.vaultToMap.set(vaultId, prevTokenScans);
      });
    }
  }

  protected async calculateTokenScan(
    vaultId: string,
    chainId: string
  ): Promise<TokenScan | undefined> {
    if (this.keyRingService.keyRingStatus !== "unlocked") {
      return;
    }

    if (this.chainsUIService.isEnabled(vaultId, chainId)) {
      return;
    }

    const tokenScan: TokenScan = {
      chainId,
      infos: [],
    };

    const modularChainInfo = this.chainsService.getModularChainInfo(chainId);
    if (modularChainInfo == null) {
      return;
    }

    if ("cosmos" in modularChainInfo) {
      const chainInfo = this.chainsService.getChainInfoOrThrow(chainId);
      if (chainInfo.hideInUI) {
        return;
      }

      if (this.chainsService.isEvmOnlyChain(chainId)) {
        const evmInfo = this.chainsService.getEVMInfoOrThrow(chainId);
        const pubkey = await this.keyRingService.getPubKey(chainId, vaultId);
        const ethereumHexAddress = `0x${Buffer.from(
          pubkey.getEthAddress()
        ).toString("hex")}`;

        const res = await simpleFetch<{
          result: string;
        }>(evmInfo.rpc, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "request-source": new URL(browser.runtime.getURL("/")).origin,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [ethereumHexAddress, "latest"],
            id: 1,
          }),
        });

        if (
          res.status === 200 &&
          BigInt(res.data.result).toString(10) !== "0"
        ) {
          tokenScan.infos.push({
            bech32Address: "",
            ethereumHexAddress,
            coinType: 60,
            assets: [
              {
                currency: chainInfo.stakeCurrency ?? chainInfo.currencies[0],
                amount: BigInt(res.data.result).toString(10),
              },
            ],
          });
        }
      } else {
        const bech32Addresses: {
          value: string;
          coinType?: number;
        }[] = await (async () => {
          if (this.keyRingService.needKeyCoinTypeFinalize(vaultId, chainId)) {
            return (
              await this.keyRingCosmosService.computeNotFinalizedKeyAddresses(
                vaultId,
                chainId
              )
            ).map((addr) => {
              return {
                value: addr.bech32Address,
                coinType: addr.coinType,
              };
            });
          } else {
            return [
              {
                value: (
                  await this.keyRingCosmosService.getKey(vaultId, chainId)
                ).bech32Address,
              },
            ];
          }
        })();

        for (const bech32Address of bech32Addresses) {
          const res = await simpleFetch<{
            balances: { denom: string; amount: string }[];
          }>(
            chainInfo.rest,
            `/cosmos/bank/v1beta1/balances/${bech32Address.value}?pagination.limit=1000`
          );

          if (res.status === 200) {
            const assets: TokenScan["infos"][number]["assets"] = [];

            const balances = res.data?.balances ?? [];
            for (const bal of balances) {
              const currency = chainInfo.currencies.find(
                (cur) => cur.coinMinimalDenom === bal.denom
              );
              if (currency) {
                // validate
                if (typeof bal.amount !== "string") {
                  throw new Error("Invalid amount");
                }

                const dec = new Dec(bal.amount);
                if (dec.gt(new Dec(0))) {
                  assets.push({
                    currency,
                    amount: bal.amount,
                  });
                }
              }
            }

            if (assets.length > 0) {
              tokenScan.infos.push({
                bech32Address: bech32Address.value,
                coinType: bech32Address.coinType,
                assets,
              });
            }
          }
        }
      }
    } else if ("starknet" in modularChainInfo) {
      const { hexAddress: starknetHexAddress } =
        await this.keyRingStarknetService.getStarknetKey(vaultId, chainId);

      await Promise.all(
        modularChainInfo.starknet.currencies.map(async (currency) => {
          const res = await simpleFetch<{
            result: string[];
          }>(modularChainInfo.starknet.rpc, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "request-source": new URL(browser.runtime.getURL("/")).origin,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "starknet_call",
              params: {
                block_id: "latest",
                request: {
                  contract_address: currency.contractAddress,
                  calldata: [starknetHexAddress],
                  // selector.getSelectorFromName("balanceOf")
                  entry_point_selector:
                    "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
                },
              },
              id: 1,
            }),
          });

          if (res.status === 200) {
            const amount = new CairoUint256({
              low: res.data.result[0],
              high: res.data.result[1],
            })
              .toBigInt()
              .toString(10);

            if (amount !== "0") {
              tokenScan.infos.push({
                starknetHexAddress,
                assets: [
                  {
                    currency,
                    amount,
                  },
                ],
              });
            }
          }
        })
      );
    }

    if (tokenScan.infos.length > 0) {
      return tokenScan;
    }

    return undefined;
  }
}
