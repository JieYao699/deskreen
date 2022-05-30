/* eslint-disable no-restricted-syntax */
import { Display, ipcMain, BrowserWindow, screen } from 'electron';
import settings from 'electron-settings';
import i18n from '../configs/i18next.config';
import ConnectedDevicesService from '../features/ConnectedDevicesService';
import SharingSession from '../features/SharingSessionService/SharingSession';
import RoomIDService from '../server/RoomIDService';
import getDeskreenGlobal from '../utils/mainProcessHelpers/getDeskreenGlobal';
import signalingServer from '../server';
import Logger from '../utils/LoggerWithFilePrefix';
import { IpcEvents } from './IpcEvents.enum';
import SharingSessionStatusEnum from '../features/SharingSessionService/SharingSessionStatusEnum';

const log = new Logger(__filename);
const v4IPGetter = require('internal-ip').v4;

export default function initIpcMainHandlers(
  mainWindow: BrowserWindow,
  latestVersion: string,
  appVersion: string
) {
  ipcMain.on('client-changed-language', async (_, newLangCode) => {
    i18n.changeLanguage(newLangCode);
    await settings.set('appLanguage', newLangCode);
  });

  ipcMain.handle('get-signaling-server-port', () => {
    if (mainWindow === null) return;
    mainWindow.webContents.send('sending-port-from-main', signalingServer.port);
  });

  ipcMain.handle('get-all-displays', () => {
    return screen.getAllDisplays();
  });

  ipcMain.handle('get-display-size-by-display-id', (_, displayID: string) => {
    const display = screen.getAllDisplays().find((d: Display) => {
      return `${d.id}` === displayID;
    });

    if (display) {
      return display.size;
    }
    return undefined;
  });

  ipcMain.handle('main-window-onbeforeunload', () => {
    const deskreenGlobal = getDeskreenGlobal();
    deskreenGlobal.connectedDevicesService = new ConnectedDevicesService();
    deskreenGlobal.roomIDService = new RoomIDService();
    deskreenGlobal.sharingSessionService.sharingSessions.forEach(
      (sharingSession: SharingSession) => {
        sharingSession.denyConnectionForPartner();
        sharingSession.destroy();
      }
    );

    deskreenGlobal.rendererWebrtcHelpersService.helpers.forEach(
      (helperWindow) => {
        helperWindow.close();
      }
    );

    deskreenGlobal.sharingSessionService.waitingForConnectionSharingSession = null;
    deskreenGlobal.rendererWebrtcHelpersService.helpers.clear();
    deskreenGlobal.sharingSessionService.sharingSessions.clear();
  });

  ipcMain.handle('get-latest-version', () => {
    return latestVersion;
  });

  ipcMain.handle('get-current-version', () => {
    return appVersion;
  });

  ipcMain.handle('get-local-lan-ip', async () => {
    if (
      process.env.RUN_MODE === 'dev' ||
      process.env.NODE_ENV === 'production'
    ) {
      const ip = await v4IPGetter();
      return ip;
    }
    return '255.255.255.255';
  });

  ipcMain.handle(IpcEvents.GetAppPath, () => {
    const deskreenGlobal = getDeskreenGlobal();
    return deskreenGlobal.appPath;
  });

  ipcMain.handle(IpcEvents.UnmarkRoomIDAsTaken, (_, roomID) => {
    const deskreenGlobal = getDeskreenGlobal();
    deskreenGlobal.roomIDService.unmarkRoomIDAsTaken(roomID);
  });

  function onDeviceConnectedCallback(device: Device): void {
    getDeskreenGlobal().connectedDevicesService.setPendingConnectionDevice(
      device
    );
    mainWindow.webContents.send(IpcEvents.SetPendingConnectionDevice, device);
  }

  ipcMain.handle(IpcEvents.CreateWaitingForConnectionSharingSession, () => {
    getDeskreenGlobal()
      .sharingSessionService.createWaitingForConnectionSharingSession()
      // eslint-disable-next-line promise/always-return
      .then((waitingForConnectionSharingSession) => {
        waitingForConnectionSharingSession.setOnDeviceConnectedCallback(
          onDeviceConnectedCallback
        );
      })
      .catch((e) => log.error(e));
  });

  ipcMain.handle(IpcEvents.ResetWaitingForConnectionSharingSession, () => {
    const sharingSession = getDeskreenGlobal().sharingSessionService
      .waitingForConnectionSharingSession;
    sharingSession?.disconnectByHostMachineUser();
    sharingSession?.destroy();
    sharingSession?.setStatus(SharingSessionStatusEnum.NOT_CONNECTED);
    getDeskreenGlobal().sharingSessionService.sharingSessions.delete(
      sharingSession?.id as string
    );
    getDeskreenGlobal().sharingSessionService.waitingForConnectionSharingSession = null;
  });

  ipcMain.handle(IpcEvents.SetDeviceConnectedStatus, () => {
    if (
      getDeskreenGlobal().sharingSessionService
        .waitingForConnectionSharingSession !== null
    ) {
      const sharingSession = getDeskreenGlobal().sharingSessionService
        .waitingForConnectionSharingSession;
      sharingSession?.setStatus(SharingSessionStatusEnum.CONNECTED);
    }
  });

  ipcMain.handle(
    IpcEvents.GetSourceDisplayIDByDesktopCapturerSourceID,
    (_, sourceId) => {
      return getDeskreenGlobal().desktopCapturerSourcesService.getSourceDisplayIDByDisplayCapturerSourceID(
        sourceId
      );
    }
  );

  ipcMain.handle(
    IpcEvents.DisconnectPeerAndDestroySharingSessionBySessionID,
    (_, sessionId) => {
      const sharingSession = getDeskreenGlobal().sharingSessionService.sharingSessions.get(
        sessionId
      );
      sharingSession?.disconnectByHostMachineUser();
      sharingSession?.destroy();
      getDeskreenGlobal().sharingSessionService.sharingSessions.delete(
        sessionId
      );
    }
  );

  ipcMain.handle(
    IpcEvents.GetDesktopCapturerSourceIdBySharingSessionId,
    (_, sessionId) => {
      return getDeskreenGlobal().sharingSessionService.sharingSessions.get(
        sessionId
      )?.desktopCapturerSourceID;
    }
  );

  ipcMain.handle(IpcEvents.GetConnectedDevices, () => {
    return getDeskreenGlobal().connectedDevicesService.getDevices();
  });

  ipcMain.handle(IpcEvents.DisconnectDeviceById, (_, id) => {
    getDeskreenGlobal().connectedDevicesService.disconnectDeviceByID(id);
  });

  ipcMain.handle(IpcEvents.DisconnectAllDevices, () => {
    getDeskreenGlobal().connectedDevicesService.disconnectAllDevices();
  });

  ipcMain.handle(IpcEvents.AppLanguageChanged, () => {
    getDeskreenGlobal().sharingSessionService.sharingSessions.forEach(
      (sharingSession) => {
        sharingSession?.appLanguageChanged();
      }
    );
  });

  ipcMain.handle(IpcEvents.GetDesktopCapturerServiceSourcesMap, () => {
    const map = getDeskreenGlobal().desktopCapturerSourcesService.getSourcesMap();
    const res = {};
    // eslint-disable-next-line guard-for-in
    for (const key of map.keys()) {
      const source = map.get(key);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      res[key] = {
        source: {
          thumbnail: source?.source.thumbnail?.toDataURL(),
          appIcon: source?.source.appIcon?.toDataURL(),
          name: source?.source.name,
        },
      };
    }
    return res;
  });

  ipcMain.handle(
    IpcEvents.GetWaitingForConnectionSharingSessionSourceId,
    () => {
      return getDeskreenGlobal().sharingSessionService
        .waitingForConnectionSharingSession?.desktopCapturerSourceID;
    }
  );

  ipcMain.handle(
    IpcEvents.StartSharingOnWaitingForConnectionSharingSession,
    () => {
      const sharingSession = getDeskreenGlobal().sharingSessionService
        .waitingForConnectionSharingSession;
      if (sharingSession !== null) {
        sharingSession.callPeer();
        sharingSession.status = SharingSessionStatusEnum.SHARING;
      }
      getDeskreenGlobal().connectedDevicesService.addDevice(
        getDeskreenGlobal().connectedDevicesService.pendingConnectionDevice
      );
      getDeskreenGlobal().connectedDevicesService.resetPendingConnectionDevice();
    }
  );
}
