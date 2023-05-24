import React, {
  FunctionComponent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { observer } from "mobx-react-lite";
import { BackButton } from "../../../../layouts/header/components";
import { HeaderLayout } from "../../../../layouts/header";
import styled from "styled-components";
import { Stack } from "../../../../components/stack";
import { TextInput } from "../../../../components/input";
import { useStore } from "../../../../stores";
import { Dropdown } from "../../../../components/dropdown";
import { Box } from "../../../../components/box";
import { autorun } from "mobx";
import { Bech32Address } from "@keplr-wallet/cosmos";
import { AppCurrency } from "@keplr-wallet/types";
import { useNavigate } from "react-router";
import { useSearchParams } from "react-router-dom";
import { useInteractionInfo } from "../../../../hooks";
import { ColorPalette } from "../../../../styles";
import { Column, Columns } from "../../../../components/column";
import { Body3, Subtitle2 } from "../../../../components/typography";
import { Toggle } from "../../../../components/toggle";
import { useForm } from "react-hook-form";
import { useNotification } from "../../../../hooks/notification";
import { FormattedMessage, useIntl } from "react-intl";

const Styles = {
  Container: styled(Stack)`
    padding: 0 0.75rem;
  `,
};

interface FormData {
  contractAddress: string;
  // For the secret20
  viewingKey: string;
}

export const SettingTokenAddPage: FunctionComponent = observer(() => {
  const { chainStore, accountStore, queriesStore, tokensStore } = useStore();
  const intl = useIntl();

  const navigate = useNavigate();
  const notification = useNotification();
  const [searchParams] = useSearchParams();
  const paramChainId = searchParams.get("chainId");

  const { setValue, handleSubmit, register, formState, watch } =
    useForm<FormData>({
      defaultValues: {
        contractAddress: searchParams.get("contractAddress") || "",
        viewingKey: "",
      },
    });

  const supportedChainInfos = useMemo(() => {
    return chainStore.chainInfos.filter((chainInfo) => {
      return (
        chainInfo.features?.includes("cosmwasm") ||
        chainInfo.features?.includes("secretwasm")
      );
    });
  }, [chainStore.chainInfos]);

  const [chainId, setChainId] = useState<string>(() => {
    if (paramChainId) {
      return paramChainId;
    }

    if (supportedChainInfos.length > 0) {
      return supportedChainInfos[0].chainId;
    } else {
      return chainStore.chainInfos[0].chainId;
    }
  });

  // secret20은 서명 페이지로 넘어가야하기 때문에 막아야함...
  const blockRejectAll = useRef(false);
  const interactionInfo = useInteractionInfo(() => {
    if (!blockRejectAll.current) {
      tokensStore.rejectAllSuggestedTokens();
    }
  });

  useLayoutEffect(() => {
    if (interactionInfo.interaction) {
      if (tokensStore.waitingSuggestedToken) {
        setChainId(tokensStore.waitingSuggestedToken.data.chainId);
        setValue(
          "contractAddress",
          tokensStore.waitingSuggestedToken.data.contractAddress
        );
      }
    }
  }, [interactionInfo, setValue, tokensStore.waitingSuggestedToken]);

  useEffect(() => {
    // secret20은 계정에 귀속되기 때문에 추가/삭제 등을 할때 먼저 초기화가 되어있어야만 가능하다.
    // 이를 보장하기 위해서 이 로직이 추가됨...
    const disposal = autorun(() => {
      const account = accountStore.getAccount(chainId);
      if (account.bech32Address === "") {
        account.init();
      }
    });

    return () => {
      if (disposal) {
        disposal();
      }
    };
  }, [accountStore, chainId]);

  const isSecretWasm = chainStore.getChain(chainId).hasFeature("secretwasm");
  const [isOpenSecret20ViewingKey, setIsOpenSecret20ViewingKey] =
    useState(false);

  const items = supportedChainInfos.map((chainInfo) => {
    return {
      key: chainInfo.chainId,
      label: chainInfo.chainName,
    };
  });

  const contractAddress = watch("contractAddress").trim();
  const queryContract = (() => {
    if (isSecretWasm) {
      return queriesStore
        .get(chainId)
        .secret.querySecret20ContractInfo.getQueryContract(contractAddress);
    } else {
      return queriesStore
        .get(chainId)
        .cosmwasm.querycw20ContractInfo.getQueryContract(contractAddress);
    }
  })();

  const createViewingKey = async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      accountStore
        .getAccount(chainId)
        .secret.createSecret20ViewingKey(
          contractAddress,
          "",
          {},
          {},
          (tx, viewingKey) => {
            if (tx.code != null && tx.code !== 0) {
              reject(new Error(tx.raw_log));
              return;
            }

            if (!viewingKey) {
              reject(new Error("Viewing key is null"));
              return;
            }
            resolve(viewingKey);
          }
        )
        .catch(reject);
    });
  };

  return (
    <HeaderLayout
      title={intl.formatMessage({ id: "pages.setting.token.add.header" })}
      left={
        <BackButton
          hidden={
            interactionInfo.interaction && !interactionInfo.interactionInternal
          }
        />
      }
      bottomButton={{
        text: intl.formatMessage({
          id: "pages.setting.token.add.confirm-button",
        }),
        color: "secondary",
        size: "large",
        disabled:
          contractAddress.length === 0 ||
          !queryContract.tokenInfo ||
          (isSecretWasm && !accountStore.getAccount(chainId).isReadyToSendTx),
      }}
      onSubmit={handleSubmit(async (data) => {
        if (queryContract.tokenInfo) {
          let currency: AppCurrency;

          if (isSecretWasm) {
            let viewingKey = data.viewingKey;

            if (!viewingKey && !isOpenSecret20ViewingKey) {
              try {
                blockRejectAll.current = true;
                viewingKey = await createViewingKey();
              } catch (e) {
                notification.show(
                  "failed",
                  intl.formatMessage({
                    id: "pages.setting.token.add.submit-fail-notification",
                  }),
                  e.message || e.toString()
                );

                await new Promise((resolve) => setTimeout(resolve, 2000));

                window.close();
                return;
              }
            }

            currency = {
              type: "secret20",
              contractAddress,
              viewingKey,
              coinMinimalDenom: queryContract.tokenInfo.name,
              coinDenom: queryContract.tokenInfo.symbol,
              coinDecimals: queryContract.tokenInfo.decimals,
            };
          } else {
            currency = {
              type: "cw20",
              contractAddress: contractAddress,
              coinMinimalDenom: queryContract.tokenInfo.name,
              coinDenom: queryContract.tokenInfo.symbol,
              coinDecimals: queryContract.tokenInfo.decimals,
            };
          }

          if (
            interactionInfo.interaction &&
            tokensStore.waitingSuggestedToken
          ) {
            await tokensStore.approveSuggestedTokenWithProceedNext(
              tokensStore.waitingSuggestedToken.id,
              currency,
              (proceedNext) => {
                if (!proceedNext) {
                  if (
                    interactionInfo.interaction &&
                    !interactionInfo.interactionInternal
                  ) {
                    window.close();
                  }
                }

                if (
                  interactionInfo.interaction &&
                  !interactionInfo.interactionInternal &&
                  isSecretWasm
                ) {
                  // TODO: secret20의 경우는 서명 페이지로 페이지 자체가 넘어가기 때문에 proceedNext를 처리할 수가 없다.
                  //       나중에 뭔가 해결법이 생기면 다시 생각해본다...
                  window.close();
                }
              }
            );
          } else {
            await tokensStore.addToken(chainId, currency);

            navigate("/");
          }
        }
      })}
    >
      <Styles.Container gutter="1rem">
        {!interactionInfo.interaction ? (
          <Box width="13rem">
            <Dropdown
              items={items}
              selectedItemKey={chainId}
              onSelect={setChainId}
            />
          </Box>
        ) : null}

        <TextInput
          label={intl.formatMessage({
            id: "pages.setting.token.add.contract-address-input-text",
          })}
          isLoading={queryContract.isFetching}
          readOnly={interactionInfo.interaction}
          error={
            formState.errors.contractAddress?.message ||
            (queryContract.error?.data as any)?.message
          }
          {...register("contractAddress", {
            required: true,
            validate: (value): string | undefined => {
              try {
                const chainInfo = chainStore.getChain(chainId);
                Bech32Address.validate(
                  value,
                  chainInfo.bech32Config.bech32PrefixAccAddr
                );
              } catch (e) {
                return e.message || e.toString();
              }
            },
          })}
        />
        <TextInput
          label={intl.formatMessage({
            id: "pages.setting.token.add.name-input-text",
          })}
          value={queryContract.tokenInfo?.name || "-"}
          disabled
        />
        <TextInput
          label={intl.formatMessage({
            id: "pages.setting.token.add.symbol-input-text",
          })}
          value={queryContract.tokenInfo?.symbol || "-"}
          disabled
        />
        <TextInput
          label={intl.formatMessage({
            id: "pages.setting.token.add.decimals-input-text",
          })}
          value={queryContract.tokenInfo?.decimals || "-"}
          disabled
        />

        {isSecretWasm ? (
          <Stack gutter="0.75rem">
            <Box
              backgroundColor={ColorPalette["gray-600"]}
              borderRadius="0.375rem"
              padding="1rem"
            >
              <Columns sum={1} alignY="center" gutter="0.25rem">
                <Column weight={1}>
                  <Stack>
                    <Subtitle2 color={ColorPalette["gray-50"]}>
                      <FormattedMessage id="pages.setting.token.add.secret.sub-title" />
                    </Subtitle2>
                    <Body3 color={ColorPalette["gray-200"]}>
                      <FormattedMessage id="pages.setting.token.add.secret.text" />
                    </Body3>
                  </Stack>
                </Column>

                <Toggle
                  isOpen={isOpenSecret20ViewingKey}
                  setIsOpen={setIsOpenSecret20ViewingKey}
                />
              </Columns>
            </Box>

            {isOpenSecret20ViewingKey ? (
              <TextInput
                label={intl.formatMessage({
                  id: "pages.setting.token.add.viewing-key-input-text",
                })}
                error={
                  formState.errors.viewingKey
                    ? formState.errors.viewingKey.message
                    : undefined
                }
                {...register("viewingKey", {
                  required: true,
                })}
              />
            ) : null}
          </Stack>
        ) : null}
      </Styles.Container>
    </HeaderLayout>
  );
});
