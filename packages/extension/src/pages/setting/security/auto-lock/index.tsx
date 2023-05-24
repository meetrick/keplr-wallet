import React, { FunctionComponent, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { HeaderLayout } from "../../../../layouts/header";
import { BackButton } from "../../../../layouts/header/components";
import { Body2, Body3, Subtitle2 } from "../../../../components/typography";
import { ColorPalette } from "../../../../styles";
import { Box } from "../../../../components/box";
import { Gutter } from "../../../../components/gutter";
import { TextInput } from "../../../../components/input";
import { Column, Columns } from "../../../../components/column";
import { Stack } from "../../../../components/stack";
import { Toggle } from "../../../../components/toggle";
import {
  GetAutoLockAccountDurationMsg,
  GetLockOnSleepMsg,
  SetLockOnSleepMsg,
  UpdateAutoLockAccountDurationMsg,
} from "@keplr-wallet/background";
import { InExtensionMessageRequester } from "@keplr-wallet/router-extension";
import { BACKGROUND_PORT } from "@keplr-wallet/router";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { YAxis } from "../../../../components/axis";
import lottie from "lottie-web";
import AnimShield from "../../../../public/assets/lottie/wallet/shield.json";
import { FormattedMessage, useIntl } from "react-intl";

export const SettingSecurityAutoLockPage: FunctionComponent = observer(() => {
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const intl = useIntl();

  const minDuration = 0;
  const maxDuration = 4320;

  const { watch, setValue, register, handleSubmit, formState, setFocus } =
    useForm<{
      timer: string;
    }>({
      mode: "onChange",
      defaultValues: {
        timer: "0",
      },
    });

  const watchTimer = watch("timer");
  const watchTimerParsed = parseInt(watchTimer);

  const animDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const msg = new GetAutoLockAccountDurationMsg();
    new InExtensionMessageRequester()
      .sendMessage(BACKGROUND_PORT, msg)
      .then(function (duration) {
        setValue("timer", Math.floor(duration / 60000).toString());
      });
  }, [setValue]);

  const [lockOnSleep, setLockOnSleep] = useState(false);
  useEffect(() => {
    setFocus("timer");

    if (animDivRef.current) {
      const anim = lottie.loadAnimation({
        container: animDivRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData: AnimShield,
      });

      return () => {
        anim.destroy();
      };
    }

    const msg = new GetLockOnSleepMsg();
    new InExtensionMessageRequester()
      .sendMessage(BACKGROUND_PORT, msg)
      .then((lockOnSleep) => {
        setLockOnSleep(lockOnSleep);
      });
  }, []);

  return (
    <HeaderLayout
      title={intl.formatMessage({
        id: "pages.setting.security.auto-lock.header",
      })}
      left={<BackButton />}
      bottomButton={{
        text: intl.formatMessage({
          id: "pages.setting.security.auto-lock.bottom-button",
        }),
        color: "secondary",
        size: "large",
        isLoading,
      }}
      onSubmit={handleSubmit(async (data) => {
        setIsLoading(true);

        let duration = parseInt(data.timer);
        if (!Number.isNaN(duration) && duration >= 0) {
          duration = duration * 60000;
          const msg = new UpdateAutoLockAccountDurationMsg(duration);
          await new InExtensionMessageRequester().sendMessage(
            BACKGROUND_PORT,
            msg
          );

          if (duration === 0) {
            const msg = new SetLockOnSleepMsg(lockOnSleep);
            await new InExtensionMessageRequester().sendMessage(
              BACKGROUND_PORT,
              msg
            );
          }
        } else {
          const msg = new SetLockOnSleepMsg(lockOnSleep);
          await new InExtensionMessageRequester().sendMessage(
            BACKGROUND_PORT,
            msg
          );
        }

        setIsLoading(false);

        navigate(-1);
      })}
    >
      <Box paddingX="0.75rem" alignX="center">
        <Body2
          color={ColorPalette["gray-200"]}
          style={{ textAlign: "center", padding: "2rem 1.25rem" }}
        >
          <FormattedMessage id="pages.setting.security.auto-lock.content" />
        </Body2>

        <YAxis alignX="center">
          <div
            ref={animDivRef}
            style={{
              backgroundColor: ColorPalette["gray-600"],
              borderRadius: "2.5rem",
              width: "8.5rem",
              height: "8.5rem",
            }}
          />
        </YAxis>

        <Gutter size="3.125rem" />

        <Box width="100%">
          <TextInput
            label={intl.formatMessage({
              id: "pages.setting.security.auto-lock.timer-input-text",
            })}
            type="number"
            error={formState.errors.timer && formState.errors.timer.message}
            {...register("timer", {
              validate: (input: string): string | undefined => {
                if (input.trim().length === 0) {
                  return;
                }

                if (input.includes(".")) {
                  return intl.formatMessage({
                    id: "pages.setting.security.auto-lock.timer-input-integer-caution",
                  });
                }

                const duration = parseInt(input);

                if (Number.isNaN(duration)) {
                  return "NaN";
                }

                if (duration < minDuration || duration > maxDuration) {
                  return intl.formatMessage(
                    {
                      id: "pages.setting.security.auto-lock.timer-input-duration-caution",
                    },
                    { maxDuration, minDuration }
                  );
                }
              },
            })}
          />
        </Box>

        <Gutter size="1rem" />

        <Box
          backgroundColor={ColorPalette["gray-600"]}
          borderRadius="0.375rem"
          padding="1rem"
          width="100%"
        >
          <Columns sum={1} alignY="center">
            <Column weight={1}>
              <Stack gutter="0.375rem">
                <Subtitle2 color={ColorPalette["gray-50"]}>
                  <FormattedMessage id="pages.setting.security.auto-lock.sleep-mode-title" />
                </Subtitle2>
                <Body3 color={ColorPalette["gray-200"]}>
                  <FormattedMessage
                    id="pages.setting.security.auto-lock.sleep-mode-text"
                    values={{ br: <br /> }}
                  />
                </Body3>
              </Stack>
            </Column>

            <Toggle
              isOpen={
                (!Number.isNaN(watchTimerParsed) && watchTimerParsed !== 0) ||
                lockOnSleep
              }
              setIsOpen={(value) => {
                if (Number.isNaN(watchTimerParsed) || watchTimerParsed === 0) {
                  setLockOnSleep(value);
                }
              }}
            />
          </Columns>
        </Box>
      </Box>
    </HeaderLayout>
  );
});
