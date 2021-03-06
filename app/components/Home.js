// @flow
import React, { Component } from 'react';
import Axios from 'axios';
import { Link } from 'react-router';
import AlertContainer from 'react-alert';
import Sound from 'react-sound';
import arrayMove from 'react-sortable-hoc';

import SidebarMenu from './SidebarMenu';
import Navbar from './Navbar';
import QueueBar from './QueueBar';
import DownloadQueue from './DownloadQueue';
import MainContent from './MainContent';
import Player from './Player';
import styles from './Home.css';

const fs = require('fs');
const path = require('path');
const ytdl = require('ytdl-core');

const bandcamp = require('../api/Bandcamp');
const enums = require('../api/Enum');
const globals = require('../api/Globals');
const lastfm = require('../api/Lastfm');
const settingsApi = require('../api/SettingsApi');
const songInfo = require('../api/SongInfo');
const vimeo = require('../api/Vimeo');
const youtube = require('../api/Youtube');


export default class Home extends Component {
  constructor(props) {
    super(props);
    this.state = {
      queuebarOpen: false,
      songQueue: [],
      downloadQueue: [],
      playStatus: Sound.status.STOPPED,
      currentSongNumber: 0,
      currentSongUrl: '',
      currentSongPosition: 0,
      currentSongDuration: 0,
      currentSongProgress: 0,
      seekFromPosition: 0,
      songStreamLoading: false,
      sidebarContents: enums.SidebarMenuItemEnum.DEFAULT,
      mainContents: enums.MainContentItemEnum.DASHBOARD
    };

    this.alertOptions = {
          position: 'bottom right',
          theme: 'dark',
          time: 5000,
          transition: 'fade',
        };
  }

  seekFrom(percent) {
    this.setState({
      seekFromPosition: percent * this.state.currentSongDuration
    });
  }

  songLoadingCallback(loading) {
    this.setState({songStreamLoading: !loading.loaded});
  }

  songPlayingCallback(playing) {
    var progress = Math.round((playing.position/playing.duration)*100.0);

    this.setState({
      currentSongPosition: playing.position,
      currentSongDuration: playing.duration,
      currentSongProgress: progress,
      songStreamLoading: false
    });
  }

  songFinishedPlayingCallback() {
    // last.fm scrobbling
    var info = songInfo.getArtistAndTrack(
      this.state.songQueue[this.state.currentSongNumber].data.title
    );
    lastfm.scrobble(
      settingsApi.loadFromSettings('lastfmSession'),
      info.artist,
      info.track
    );

    this.setState({
      currentSongPosition: 0,
      seekFromPosition: 0,
    });

    if (this.state.currentSongNumber==this.state.songQueue.length-1){
      this.setState({playStatus: Sound.status.STOPPED});
    } else {
      this.nextSong();
    }
  }

  nextSong() {
    this.changeSong(Math.min(
      this.state.currentSongNumber+1,
      this.state.songQueue.length-1
    ));
  }

  prevSong() {
    this.changeSong(Math.max(this.state.currentSongNumber-1,0));
  }

  changeSong(num) {
    // We need to update state in two steps - first we update the current song
    // number, then we update the url to reflect the new number.
    this.setState((prevState, props) => ({
      currentSongNumber: num
    }));

    this.setState((prevState, props) => ({
      currentSongUrl: prevState.songQueue[prevState.currentSongNumber].data.streamUrl
    }));
  }

  arrayMove (arr, previousIndex, newIndex) {
    const array = arr.slice(0);
    if (newIndex >= array.length) {
        let k = newIndex - array.length;
        while ((k--) + 1) {
            array.push(undefined);
        }
    }
    array.splice(newIndex, 0, array.splice(previousIndex, 1)[0]);
    return array;
  }

  changeQueueOrder(oldIndex, newIndex) {
    this.setState({
      songQueue: this.arrayMove(this.state.songQueue, oldIndex, newIndex),
    });

    if (oldIndex===this.state.currentSongNumber) {
      this.setState({
        currentSongNumber: newIndex
      });
    }
  }

  videoInfoCallback(song, playNow, err, info) {
    var formatInfo = info.formats.filter(function(e){return e.itag=='140'})[0];
    song.data.streamUrl = formatInfo.url;
    song.data.streamUrlLoading = false;
    song.data.streamLength = formatInfo.clen;
    this.setState({songQueue: this.state.songQueue});
    if(playNow) this.togglePlay();
  }

  videoInfoThenPlayCallback(song, err, info) {
    this.videoInfoCallback(song, err, info);
    this.togglePlay();
  }

  downloadVideoInfoCallback(song, err, info) {
    var formatInfo = info.formats.filter(function(e){return e.itag=='140'})[0];
    song.length = formatInfo.clen;
    this.setState({});
  }

  addFromPlaylistCallback(songs) {
    songs.map((el, i) => {
      youtube.youtubeFetchVideoDetails(el);
      this.addToQueue(el, this.videoInfoCallback, null)
    });

    this.togglePlay();
  }

  removeFromQueue(song) {
    this.state.songQueue.splice(this.state.songQueue.indexOf(song), 1);
    this.setState({songQueue: this.state.songQueue});
  }

  addToQueue(song, playNow, event) {
    if (song.source === 'youtube'){
      song.data.streamUrlLoading = true;
      ytdl.getInfo(
        `http://www.youtube.com/watch?v=${song.data.id}`,
         this.videoInfoCallback.bind(this, song, playNow)
      );

      this.state.songQueue.push(song);
    } else if (song.source === 'youtube playlists') {
      youtube.youtubeGetSongsFromPlaylist(song.data.id,
      (songs) => {
        songs.map((el, i) => {
          youtube.youtubeFetchVideoDetails(el);
          this.addToQueue(el, playNow&&i===0, null);
        });
      });
    } else if (song.source === 'soundcloud' || song.source === 'mp3monkey') {
      this.state.songQueue.push(song);
      if(playNow) this.togglePlay();
    } else if (song.source === 'vimeo') {
      vimeo.vimeoFetchStream(song, (video) => {
        this.state.songQueue.push(video);
        this.setState(this.state);
        if(playNow) this.togglePlay();
      });
    } else if (song.source === 'bandcamp track') {
      song.data.streamUrlLoading = true;
      bandcamp.getTrackStream(song.data.id, (result) => {
        song.data.streamUrl = result;
        song.data.streamUrlLoading = false;
        this.state.songQueue.push(song);
        if(playNow) this.togglePlay();
      });
    } else if(song.source === 'bandcamp album') {
      bandcamp.getAlbumTracks(song, (err, result) => {
        if(err) {
          console.error(err);
          showAlertError('Could not add album ' + song.data.title + '. Bandcamp returned invalid data.');
          return;
        }
        result.map((el, i) => {
          this.addToQueue(el, playNow&&i===0, event);
        });
      });
    }

    this.setState({songQueue: this.state.songQueue});
  }

  playNow(song, event) {
    this.clearQueue();
    this.state.songQueue.length = 0;
    this.addToQueue(song, true, event);
  }

  clearQueue() {
    this.setState({
      playStatus: Sound.status.STOPPED,
      songQueue: [],
      currentSongNumber: 0,
      currentSongPosition: 0,
      seekFromPosition: 0,
      songStreamLoading: false
    });
  }

  toggleMainContents(content) {
    this.setState({mainContents: content});
  }

  toggleSidebarContents(content) {
    this.setState({sidebarContents: content});
  }

  startDownload() {
    this.state.downloadQueue.map((song)=>{
      if (song.status === enums.DownloadQueueStatusEnum.QUEUED){
        song.status = enums.DownloadQueueStatusEnum.INPROGRESS;

        ytdl(`http://www.youtube.com/watch?v=${song.data.id}`, {quality: '140'})
        .on('data', (chunk)=>{
          song.progress += chunk.length;
          song.progressUpdates++;
          if (song.progressUpdates%10 === 0) {
            this.setState({downloadQueue: this.state.downloadQueue});
          }
        })
        .pipe(fs.createWriteStream(
          path.join(
            globals.directories.userdata,
            globals.directories.downloads,
            song.data.title+'.m4a'
          )
        ))
        .on('finish', ()=>{
          song.status = enums.DownloadQueueStatusEnum.FINISHED;
          this.setState({downloadQueue: this.state.downloadQueue});
        })
        .on('error', (error)=>{
          song.status = enums.DownloadQueueStatusEnum.ERROR;
          this.setState({downloadQueue: this.state.downloadQueue});
        });
      }
    });

    this.setState({downloadQueue: this.state.downloadQueue});
  }

  addToDownloads(song, object, event) {
    var newDownloadItem = {
      source: song.source,
      status: enums.DownloadQueueStatusEnum.QUEUED,
      length: song.data.streamLength,
      progress: 0,
      progressUpdates: 0,
      data: {
        id: song.data.id,
        title: song.data.title
      }
    };

    ytdl.getInfo(
      `http://www.youtube.com/watch?v=${song.data.id}`,
      this.downloadVideoInfoCallback.bind(this, newDownloadItem)
    );

    this.state.downloadQueue.push(newDownloadItem);
    this.setState(this.state);

    this.showAlertSuccess('Song "'+song.data.title+'" added to downloads.');
  }

  togglePlay(){
    if (this.state.playStatus===Sound.status.PLAYING) {
      this.setState({playStatus: Sound.status.STOPPED});
    } else {
      this.setState({
        playStatus: Sound.status.PLAYING,
        currentSongUrl: this.state.songQueue[this.state.currentSongNumber].data.streamUrl,
        seekFromPosition: this.state.currentSongPosition
      });

      // last.fm scrobbling
      var info = songInfo.getArtistAndTrack(
        this.state.songQueue[this.state.currentSongNumber].data.title
      );
      lastfm.updateNowPlaying(
        settingsApi.loadFromSettings('lastfmSession'),
        info.artist,
        info.track
      );
    }
  }

  showAlertInfo(text){
    msg.info(text);
  }

  showAlertSuccess(text){
    msg.success(text);
  }

  showAlertError(text){
    msg.error(text);
  }

  render() {
    var sidebarContentsRendered = '';
    switch (this.state.sidebarContents) {
      case enums.SidebarMenuItemEnum.DEFAULT:
        break;
      case enums.SidebarMenuItemEnum.QUEUE:
        sidebarContentsRendered = (
          <QueueBar
          queue={this.state.songQueue}
          currentSong={this.state.currentSongNumber}
          clearQueue={this.clearQueue.bind(this)}
          changeSong={this.changeSong.bind(this)}
          changeQueueOrder={this.changeQueueOrder.bind(this)}
          home={this}
          />
        );
        break;

      case enums.SidebarMenuItemEnum.DOWNLOADS:
        sidebarContentsRendered = (
          <DownloadQueue
            downloads={this.state.downloadQueue}
            startDownload={this.startDownload.bind(this)}
          />
        );
        break;
    }

    return (
      <div>
        <SidebarMenu
          playStatus={this.state.playStatus}
          togglePlayCallback={this.togglePlay.bind(this)}
          nextSongCallback={this.nextSong.bind(this)}
          prevSongCallback={this.prevSong.bind(this)}
          seekFromCallback={this.seekFrom.bind(this)}
          songStreamLoading={this.state.songStreamLoading}
          toggleMainContents={this.toggleMainContents.bind(this)}
          toggleSidebarContents={this.toggleSidebarContents.bind(this)}
          goBackCallback={this.toggleSidebarContents.bind(this, enums.SidebarMenuItemEnum.DEFAULT)}
          songQueue={this.state.songQueue}
          currentSongNumber={this.state.currentSongNumber}
          currentSongProgress={this.state.currentSongProgress}
          menu={sidebarContentsRendered}
        />

        <div className={styles.container}>
           <MainContent
             contents={this.state.mainContents}
             addToQueue={this.addToQueue}
             addToDownloads={this.addToDownloads.bind(this)}
             playNow={this.playNow}
             home={this}
           />

           <AlertContainer
             ref={(a) => global.msg = a}
             {...this.alertOptions}
            />
        </div>

        <Sound
          url={this.state.currentSongUrl}
          playStatus={this.state.playStatus}
          onLoading={this.songLoadingCallback.bind(this)}
          onPlaying={this.songPlayingCallback.bind(this)}
          onFinishedPlaying={this.songFinishedPlayingCallback.bind(this)}
          playFromPosition={this.state.seekFromPosition}
        />

      </div>
    );
  }
}
