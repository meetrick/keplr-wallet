import { AccountSetBase, AccountSetBaseSuper, MsgOpt } from "./base";
import { SecretQueries, QueriesSetBase, IQueriesStore } from "../query";
import { Buffer } from "buffer/";
import { ChainGetter, CoinPrimitive } from "../common";
import { StdFee } from "@cosmjs/launchpad";
import { DenomHelper } from "@keplr-wallet/common";
import { Dec, DecUtils } from "@keplr-wallet/unit";
import { AppCurrency, KeplrSignOptions } from "@keplr-wallet/types";
import { DeepPartial, DeepReadonly, Optional } from "utility-types";
import { cosmos } from "@keplr-wallet/cosmos";
import { CosmosAccount } from "./cosmos";
import deepmerge from "deepmerge";

export interface SecretAccount {
  secret: SecretAccountImpl;
}

export const SecretAccount = {
  use(options: {
    msgOptsCreator?: (
      chainId: string
    ) => DeepPartial<SecretMsgOpts> | undefined;
    queriesStore: IQueriesStore<SecretQueries>;
  }): (
    base: { accountSetBase: AccountSetBaseSuper & CosmosAccount },
    chainGetter: ChainGetter,
    chainId: string
  ) => SecretAccount {
    return (base, chainGetter, chainId) => {
      const msgOptsFromCreator = options.msgOptsCreator
        ? options.msgOptsCreator(chainId)
        : undefined;

      return {
        secret: new SecretAccountImpl(
          base.accountSetBase,
          chainGetter,
          chainId,
          options.queriesStore,
          deepmerge<SecretMsgOpts, DeepPartial<SecretMsgOpts>>(
            defaultSecretMsgOpts,
            msgOptsFromCreator ? msgOptsFromCreator : {}
          )
        ),
      };
    };
  },
};

export interface SecretMsgOpts {
  readonly send: {
    readonly secret20: Pick<MsgOpt, "gas">;
  };

  readonly createSecret20ViewingKey: Pick<MsgOpt, "gas">;
  readonly executeSecretWasm: Pick<MsgOpt, "type">;
}

export const defaultSecretMsgOpts: SecretMsgOpts = {
  send: {
    secret20: {
      gas: 250000,
    },
  },

  createSecret20ViewingKey: {
    gas: 150000,
  },

  executeSecretWasm: {
    type: "wasm/MsgExecuteContract",
  },
};

export class SecretAccountImpl {
  constructor(
    protected readonly base: AccountSetBase & CosmosAccount,
    protected readonly chainGetter: ChainGetter,
    protected readonly chainId: string,
    protected readonly queriesStore: IQueriesStore<SecretQueries>,
    protected readonly msgOpts: SecretMsgOpts
  ) {
    this.base.registerSendTokenFn(this.processSendToken.bind(this));
  }

  protected async processSendToken(
    amount: string,
    currency: AppCurrency,
    recipient: string,
    memo: string,
    stdFee: Partial<StdFee>,
    signOptions?: KeplrSignOptions,
    onTxEvents?:
      | ((tx: any) => void)
      | {
          onBroadcasted?: (txHash: Uint8Array) => void;
          onFulfill?: (tx: any) => void;
        }
  ): Promise<boolean> {
    const denomHelper = new DenomHelper(currency.coinMinimalDenom);

    switch (denomHelper.type) {
      case "secret20":
        const actualAmount = (() => {
          let dec = new Dec(amount);
          dec = dec.mul(DecUtils.getPrecisionDec(currency.coinDecimals));
          return dec.truncate().toString();
        })();

        if (!("type" in currency) || currency.type !== "secret20") {
          throw new Error("Currency is not secret20");
        }
        await this.sendExecuteSecretContractMsg(
          "send",
          currency.contractAddress,
          {
            transfer: {
              recipient: recipient,
              amount: actualAmount,
            },
          },
          [],
          memo,
          {
            amount: stdFee.amount ?? [],
            gas: stdFee.gas ?? this.msgOpts.send.secret20.gas.toString(),
          },
          signOptions,
          this.txEventsWithPreOnFulfill(onTxEvents, (tx) => {
            if (tx.code == null || tx.code === 0) {
              // After succeeding to send token, refresh the balance.
              const queryBalance = this.queries.queryBalances
                .getQueryBech32Address(this.base.bech32Address)
                .balances.find((bal) => {
                  return (
                    bal.currency.coinMinimalDenom === currency.coinMinimalDenom
                  );
                });

              if (queryBalance) {
                queryBalance.fetch();
              }
            }
          })
        );
        return true;
    }

    return false;
  }

  async createSecret20ViewingKey(
    contractAddress: string,
    memo: string = "",
    stdFee: Partial<StdFee> = {},
    signOptions?: KeplrSignOptions,
    onFulfill?: (tx: any, viewingKey: string) => void
  ) {
    const random = new Uint8Array(15);
    crypto.getRandomValues(random);
    const entropy = Buffer.from(random).toString("hex");

    const encrypted = await this.sendExecuteSecretContractMsg(
      "createSecret20ViewingKey",
      contractAddress,
      {
        create_viewing_key: { entropy },
      },
      [],
      memo,
      {
        amount: stdFee.amount ?? [],
        gas: stdFee.gas ?? this.msgOpts.createSecret20ViewingKey.gas.toString(),
      },
      signOptions,
      async (tx) => {
        let viewingKey = "";
        if (tx && "data" in tx && tx.data) {
          const txData = Buffer.from(tx.data as any, "base64");
          const dataFields = cosmos.base.abci.v1beta1.TxMsgData.decode(txData);
          if (dataFields.data.length !== 1) {
            throw new Error("Invalid length of data fields");
          }

          const dataField = dataFields.data[0];
          if (!dataField.data) {
            throw new Error("Empty data");
          }

          const keplr = await this.base.getKeplr();

          if (!keplr) {
            throw new Error("Can't get the Keplr API");
          }

          const enigmaUtils = keplr.getEnigmaUtils(this.chainId);

          const nonce = encrypted.slice(0, 32);

          const dataOutput = Buffer.from(
            Buffer.from(
              await enigmaUtils.decrypt(dataField.data, nonce)
            ).toString(),
            "base64"
          ).toString();

          // Expected: {"create_viewing_key":{"key":"api_key_1k1T...btJQo="}}
          const data = JSON.parse(dataOutput);
          viewingKey = data["create_viewing_key"]["key"];
        }

        if (onFulfill) {
          onFulfill(tx, viewingKey);
        }
      }
    );
    return;
  }

  async sendExecuteSecretContractMsg(
    // This arg can be used to override the type of sending tx if needed.
    type: keyof SecretMsgOpts | "unknown" = "executeSecretWasm",
    contractAddress: string,
    // eslint-disable-next-line @typescript-eslint/ban-types
    obj: object,
    sentFunds: CoinPrimitive[],
    memo: string = "",
    stdFee: Optional<StdFee, "amount">,
    signOptions?: KeplrSignOptions,
    onTxEvents?:
      | ((tx: any) => void)
      | {
          onBroadcasted?: (txHash: Uint8Array) => void;
          onFulfill?: (tx: any) => void;
        }
  ): Promise<Uint8Array> {
    let encryptedMsg: Uint8Array;

    await this.base.cosmos.sendMsgs(
      type,
      async () => {
        encryptedMsg = await this.encryptSecretContractMsg(
          contractAddress,
          obj
        );

        const msg = {
          type: this.msgOpts.executeSecretWasm.type,
          value: {
            sender: this.base.bech32Address,
            contract: contractAddress,
            // callback_code_hash: "",
            msg: Buffer.from(encryptedMsg).toString("base64"),
            sent_funds: sentFunds,
            // callback_sig: null,
          },
        };

        return [msg];
      },
      memo,
      {
        amount: stdFee.amount ?? [],
        gas: stdFee.gas,
      },
      signOptions,
      this.txEventsWithPreOnFulfill(onTxEvents)
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return encryptedMsg!;
  }

  protected async encryptSecretContractMsg(
    contractAddress: string,
    // eslint-disable-next-line @typescript-eslint/ban-types
    obj: object
  ): Promise<Uint8Array> {
    const queryContractCodeHashResponse = await this.queries.secret.querySecretContractCodeHash
      .getQueryContract(contractAddress)
      .waitResponse();

    if (!queryContractCodeHashResponse) {
      throw new Error(
        `Can't get the code hash of the contract (${contractAddress})`
      );
    }

    const contractCodeHash = queryContractCodeHashResponse.data.result;

    const keplr = await this.base.getKeplr();
    if (!keplr) {
      throw new Error("Can't get the Keplr API");
    }

    const enigmaUtils = keplr.getEnigmaUtils(this.chainId);
    return await enigmaUtils.encrypt(contractCodeHash, obj);
  }

  protected txEventsWithPreOnFulfill(
    onTxEvents:
      | ((tx: any) => void)
      | {
          onBroadcasted?: (txHash: Uint8Array) => void;
          onFulfill?: (tx: any) => void;
        }
      | undefined,
    preOnFulfill?: (tx: any) => void
  ):
    | {
        onBroadcasted?: (txHash: Uint8Array) => void;
        onFulfill?: (tx: any) => void;
      }
    | undefined {
    if (!onTxEvents) {
      return;
    }

    const onBroadcasted =
      typeof onTxEvents === "function" ? undefined : onTxEvents.onBroadcasted;
    const onFulfill =
      typeof onTxEvents === "function" ? onTxEvents : onTxEvents.onFulfill;

    return {
      onBroadcasted,
      onFulfill: onFulfill
        ? (tx: any) => {
            if (preOnFulfill) {
              preOnFulfill(tx);
            }

            onFulfill(tx);
          }
        : undefined,
    };
  }

  protected get queries(): DeepReadonly<QueriesSetBase & SecretQueries> {
    return this.queriesStore.get(this.chainId);
  }
}
