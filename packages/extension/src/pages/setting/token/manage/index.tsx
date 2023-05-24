import React, { FunctionComponent, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { HeaderLayout } from "../../../../layouts/header";
import { BackButton } from "../../../../layouts/header/components";
import styled from "styled-components";
import { Stack } from "../../../../components/stack";
import { Body2, H5 } from "../../../../components/typography";
import { ColorPalette } from "../../../../styles";
import { useStore } from "../../../../stores";
import { Column, Columns } from "../../../../components/column";
import { Dropdown } from "../../../../components/dropdown";
import { Box } from "../../../../components/box";
import { Button } from "../../../../components/button";
import { CopyFillIcon, KeyIcon, TrashIcon } from "../../../../components/icon";
import { useNavigate } from "react-router";
import { autorun } from "mobx";
import { TokenInfo } from "@keplr-wallet/background";
import { EmptyView } from "../../../../components/empty-view";
import { Bech32Address } from "@keplr-wallet/cosmos";
import { useConfirm } from "../../../../hooks/confirm";
import { useNotification } from "../../../../hooks/notification";
import { Gutter } from "../../../../components/gutter";
import { FormattedMessage, useIntl } from "react-intl";

const Styles = {
  Container: styled(Stack)`
    padding: 0 0.75rem;
  `,
  Paragraph: styled(Body2)`
    color: ${ColorPalette["gray-200"]};
    text-align: center;
    margin-bottom: 0.75rem;
  `,
};

export const SettingTokenListPage: FunctionComponent = observer(() => {
  const { chainStore, accountStore, tokensStore } = useStore();

  const navigate = useNavigate();
  const intl = useIntl();

  const supportedChainInfos = useMemo(() => {
    return chainStore.chainInfos.filter((chainInfo) => {
      return (
        chainInfo.features?.includes("cosmwasm") ||
        chainInfo.features?.includes("secretwasm")
      );
    });
  }, [chainStore.chainInfos]);

  const [chainId, setChainId] = useState<string>(() => {
    if (supportedChainInfos.length > 0) {
      return supportedChainInfos[0].chainId;
    } else {
      return chainStore.chainInfos[0].chainId;
    }
  });

  useEffect(() => {
    // secret20은 계정에 귀속되기 때문에 보려면 계정이 초기화되어있어야 가능하다...
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

  const items = supportedChainInfos.map((chainInfo) => {
    return {
      key: chainInfo.chainId,
      label: chainInfo.chainName,
    };
  });

  const tokens = tokensStore.getTokens(chainId);

  return (
    <HeaderLayout title="Manage Token List" left={<BackButton />}>
      <Styles.Container gutter="0.5rem">
        <Styles.Paragraph>
          <FormattedMessage id="pages.setting.token.manage.paragraph" />
        </Styles.Paragraph>

        <Columns sum={1} alignY="bottom">
          <Box width="13rem">
            <Dropdown
              items={items}
              selectedItemKey={chainId}
              onSelect={setChainId}
            />
          </Box>

          <Column weight={1} />

          <Button
            color="secondary"
            size="extraSmall"
            text={intl.formatMessage({
              id: "pages.setting.token.manage.add-token-button",
            })}
            onClick={() => navigate(`/setting/token/add?chainId=${chainId}`)}
          />
        </Columns>

        {tokens.length === 0 ? (
          <React.Fragment>
            <Gutter size="7.5rem" direction="vertical" />
            <EmptyView subject="token" />
          </React.Fragment>
        ) : (
          tokens.map((token) => {
            return (
              <TokenItem
                key={token.currency.coinMinimalDenom}
                chainId={chainId}
                tokenInfo={token}
              />
            );
          })
        )}
      </Styles.Container>
    </HeaderLayout>
  );
});

const ItemStyles = {
  Container: styled.div`
    padding: 1rem;
    background-color: ${ColorPalette["gray-600"]};
    border-radius: 0.375rem;
  `,
  Denom: styled(H5)`
    color: ${ColorPalette["gray-10"]};
  `,
  Address: styled(Body2)`
    color: ${ColorPalette["gray-200"]};
  `,
  Icon: styled.div`
    color: ${ColorPalette["gray-10"]};
    cursor: pointer;
  `,
};

const TokenItem: FunctionComponent<{
  chainId: string;
  tokenInfo: TokenInfo;
}> = observer(({ chainId, tokenInfo }) => {
  const { tokensStore } = useStore();
  const notification = useNotification();
  const intl = useIntl();

  const isSecret20 = (() => {
    if ("type" in tokenInfo.currency) {
      return tokenInfo.currency.type === "secret20";
    }
    return false;
  })();

  const confirm = useConfirm();

  return (
    <ItemStyles.Container>
      <Columns sum={1}>
        <Stack gutter="0.25rem">
          <ItemStyles.Denom>{tokenInfo.currency.coinDenom}</ItemStyles.Denom>
          <ItemStyles.Address>
            {(() => {
              if ("contractAddress" in tokenInfo.currency) {
                return Bech32Address.shortenAddress(
                  tokenInfo.currency.contractAddress,
                  26
                );
              }
              return "Unknown";
            })()}
          </ItemStyles.Address>
        </Stack>

        <Column weight={1} />

        <Columns sum={1} gutter="0.5rem" alignY="center">
          {isSecret20 ? (
            <ItemStyles.Icon
              onClick={async (e) => {
                e.preventDefault();

                if (
                  "type" in tokenInfo.currency &&
                  tokenInfo.currency.type === "secret20"
                ) {
                  await navigator.clipboard.writeText(
                    tokenInfo.currency.viewingKey
                  );

                  notification.show(
                    "success",
                    intl.formatMessage({
                      id: "pages.setting.token.manage.token-item.notification.key-copy-text",
                    }),
                    ""
                  );
                }
              }}
            >
              <KeyIcon width="1.25rem" height="1.25rem" />
            </ItemStyles.Icon>
          ) : null}

          <ItemStyles.Icon
            onClick={async (e) => {
              e.preventDefault();

              if ("contractAddress" in tokenInfo.currency) {
                await navigator.clipboard.writeText(
                  tokenInfo.currency.contractAddress
                );

                notification.show(
                  "success",
                  intl.formatMessage({
                    id: "pages.setting.token.manage.token-item.notification.address-copy-text",
                  }),
                  ""
                );
              }
            }}
          >
            <CopyFillIcon width="1.25rem" height="1.25rem" />
          </ItemStyles.Icon>

          <ItemStyles.Icon
            onClick={async (e) => {
              e.preventDefault();

              if (
                await confirm.confirm(
                  "",
                  intl.formatMessage({
                    id: "pages.setting.token.manage.token-item.confirm.remove-text",
                  })
                )
              ) {
                await tokensStore.removeToken(chainId, tokenInfo);
              }
            }}
          >
            <TrashIcon width="1.25rem" height="1.25rem" />
          </ItemStyles.Icon>
        </Columns>
      </Columns>
    </ItemStyles.Container>
  );
});
