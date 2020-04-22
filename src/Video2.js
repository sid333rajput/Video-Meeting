import React, { Component } from 'react';
import io from 'socket.io-client'
import IconButton from '@material-ui/core/IconButton';
import { Input, Button } from '@material-ui/core';

import VideocamIcon from '@material-ui/icons/Videocam';
import VideocamOffIcon from '@material-ui/icons/VideocamOff';
import MicIcon from '@material-ui/icons/Mic';
import MicOffIcon from '@material-ui/icons/MicOff';
import ScreenShareIcon from '@material-ui/icons/ScreenShare';
import StopScreenShareIcon from '@material-ui/icons/StopScreenShare';
import CallEndIcon from '@material-ui/icons/CallEnd';
import ChatIcon from '@material-ui/icons/Chat';

import { message } from 'antd';
import 'antd/dist/antd.css'

import { Container, Row, Col} from 'reactstrap';
import Modal from 'react-bootstrap/Modal'
import 'bootstrap/dist/css/bootstrap.css';
import "./Video.css"

// questo link e' eseguito con ngrok http 3000, quindi un ngrok solo per la porta 3000, e un altro per 3001 dove c'e' l'app
const server_url = process.env.NODE_ENV === 'production' ? 'https://video.sebastienbiollo.com' : "http://localhost:4001"

var connections = {}
const peerConnectionConfig = {
	'iceServers': [
		{ 'urls': 'stun:stun.services.mozilla.com' },
		{ 'urls': 'stun:stun.l.google.com:19302' },
	]
}
var socket = null
var socketId = null

class Video2 extends Component {
	constructor(props) {
		super(props)

		this.localVideoref = React.createRef()

		this.videoAvailable = false
		this.audioAvailable = false

		this.video = false
		this.audio = false
		this.screen = false

		this.state = {
			video: false,
			audio: false,
			screen: false,
			showModal: false,
			screenAvailable: false,
			messages: [],
            message: "",
            
            videos: [],
		}

		this.addMessage = this.addMessage.bind(this);

		this.getMedia()

		this.connectToSocketServer()
	}

	async getMedia() {
		await navigator.mediaDevices.getUserMedia({ video: true })
			.then((stream) => {
				this.videoAvailable = true
				this.video = true
			})
			.catch((e) => {
				this.videoAvailable = false
			})

		await navigator.mediaDevices.getUserMedia({ audio: true })
			.then((stream) => {
				this.audioAvailable = true
				this.audio = true
			})
			.catch((e) => {
				this.audioAvailable = false
			})

		this.setState({
			video: this.video,
			audio: this.audio,
			screen: this.screen
		}, () => {
			this.getUserMedia()
		})

		if (navigator.mediaDevices.getDisplayMedia) {
			this.setState({
				screenAvailable: true,
			}, () => {})
		} else {
			this.setState({
				screenAvailable: false,
			}, () => {})
		}
	}


	getUserMedia = () => {
		if ((this.state.video && this.videoAvailable) || (this.state.audio && this.audioAvailable)) {
			if (socket !== null) {
				socket.disconnect()
			}
			navigator.mediaDevices.getUserMedia({ video: this.state.video, audio: this.state.audio })
				.then(this.getUserMediaSuccess)
				.then((stream) => {
					var main = document.getElementById('main')
					var videos = main.querySelectorAll("video")
					for(let a = 0; a < videos.length; ++a){
						if(videos[a].id !== "my-video"){
							videos[a].parentNode.removeChild(videos[a])
						}
					}

					this.connectToSocketServer()
				})
				.catch((e) => console.log(e))
		} else {
			try {
				let tracks = this.localVideoref.current.srcObject.getTracks()
				tracks.forEach(track => track.stop())
			} catch (e) {
				
			}
		}
	}

	getUserMediaSuccess = (stream) => {
		window.localStream = stream
		this.localVideoref.current.srcObject = stream

		console.log("getUserMediaSuccess")

		// stream.getVideoTracks()[0].onended = () => {
		//   console.log("video / audio false")
		//   this.setState({ 
		//     video: false,
		//     audio: false,
		//     screen: this.state.screen
		//   }, () => {
		//     let tracks = this.localVideoref.current.srcObject.getTracks()
		//     tracks.forEach(track => track.stop())
		//   })
		// };
	}


	getDislayMedia = () => {
		if (this.state.screen) {
			if (socket !== null) {
				socket.disconnect()
			}

			if (navigator.mediaDevices.getDisplayMedia) {
				navigator.mediaDevices.getDisplayMedia({ video: true })
					.then(this.getDislayMediaSuccess)
					.then((stream) => {
						var main = document.getElementById('main')
						var videos = main.querySelectorAll("video")
						for(let a = 0; a < videos.length; ++a){
							if(videos[a].id !== "my-video"){
								videos[a].parentNode.removeChild(videos[a])
							}
						}

						this.connectToSocketServer()
					})
					.catch((e) => console.log(e))
			}
		}
	}

	getDislayMediaSuccess = (stream) => {
		window.localStream = stream
		this.localVideoref.current.srcObject = stream

		stream.getVideoTracks()[0].onended = () => {
			this.setState({
				video: this.state.video,
				audio: this.state.audio,
				screen: false,
			}, () => {
				try {
					let tracks = this.localVideoref.current.srcObject.getTracks()
					tracks.forEach(track => track.stop())
				} catch (e) {
					console.log(e)
				}

				this.getUserMedia()
			})
		};
	}


	gotMessageFromServer = (fromId, message) => {
		//Parse the incoming signal
		var signal = JSON.parse(message)

		//Make sure it's not coming from yourself
		if (fromId !== socketId) {
			if (signal.sdp) {
				connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
					if (signal.sdp.type === 'offer') {
						connections[fromId].createAnswer().then((description) => {
							connections[fromId].setLocalDescription(description).then(() => {
								socket.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }));
							}).catch(e => console.log(e));
						}).catch(e => console.log(e));
					}
				}).catch(e => console.log(e));
			}

			if (signal.ice) {
				connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log(e));
			}
		}
	}

	connectToSocketServer = () => {
		socket = io.connect(server_url);

		socket.on('signal', this.gotMessageFromServer);

		socket.on('connect', () => {

			console.log("connected")

			socket.emit('join-call', window.location.href);

			socketId = socket.id;

			socket.on('chat-message', this.addMessage)

			socket.on('user-left', function (id) {
				var video = document.querySelector(`[data-socket="${id}"]`);
				if (video !== null) {
					elms--
					video.parentNode.removeChild(video);

					var main = document.getElementById('main')
					var videos = main.querySelectorAll("video")

					var width = ""
					if(elms === 1 || elms === 2){
						width = "100%"
					} else if(elms === 3 || elms === 4){
						width = "40%"
					} else {
						width = String(100/elms) + "%"
					}

					var height = String(100/elms) + "%"

					for(let a = 0; a < videos.length; ++a){
						videos[a].style.minWidth = "30%"
						videos[a].style.minHeight = "30%"
						videos[a].style.setProperty("width", width)
						videos[a].style.setProperty("height", height)
					}
				}
			});

			socket.on('user-joined', function (id, clients) {
				console.log("joined")
				connections = {} // TODO eh, una merda, ma non so come fare
				clients.forEach(function (socketListId) {
					if (connections[socketListId] === undefined) {
						connections[socketListId] = new RTCPeerConnection(peerConnectionConfig);
						//Wait for their ice candidate       
						connections[socketListId].onicecandidate = function (event) {
							if (event.candidate != null) {
								socket.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }));
							}
						}

						//Wait for their video stream
						connections[socketListId].onaddstream = function (event) {

							// TODO mute button, full screen button

							elms = clients.length
							var main = document.getElementById('main')
							var videos = main.querySelectorAll("video")

							var width = ""
							if(elms === 1 || elms === 2){
								width = "100%"
							} else if(elms === 3 || elms === 4){
								width = "40%"
							} else {
								width = String(100/elms) + "%"
							}

							var height = String(100/elms) + "%"

							for(let a = 0; a < videos.length; ++a){
								videos[a].style.minWidth = "30%"
								videos[a].style.minHeight = "30%"
								videos[a].style.setProperty("width", width)
								videos[a].style.setProperty("height", height)
							}
							
							var video = document.createElement('video')
							video.style.minWidth = "30%"
							video.style.minHeight = "30%"
							video.style.setProperty("width", width)
							video.style.setProperty("height", height)
							video.style.margin = "10px"
							video.style.borderStyle = "solid"
							video.style.borderColor = "#424242"

							video.setAttribute('data-socket', socketListId);
							video.srcObject = event.stream
							video.autoplay = true;
							// video.muted       = true;
							video.playsinline = true;

							main.appendChild(video)
						}

						//Add the local video stream
						if (window.localStream !== undefined && window.localStream !== null) {
							connections[socketListId].addStream(window.localStream);
						} else {

							let silence = () => {
								let ctx = new AudioContext(), oscillator = ctx.createOscillator();
								let dst = oscillator.connect(ctx.createMediaStreamDestination());
								oscillator.start();
								return Object.assign(dst.stream.getAudioTracks()[0], {enabled: false});
							}
							
							let black = ({width = 640, height = 480} = {}) => {
								let canvas = Object.assign(document.createElement("canvas"), {width, height});
								canvas.getContext('2d').fillRect(0, 0, width, height);
								let stream = canvas.captureStream();
								return Object.assign(stream.getVideoTracks()[0], {enabled: false});
							}
							
							let blackSilence = (...args) => new MediaStream([black(...args), silence()]);
							
							connections[socketListId].addStream(blackSilence());
						}
					}
				});

				//Create an offer to connect with your local description
				connections[id].createOffer().then((description) => {
					connections[id].setLocalDescription(description)
						.then(() => {
							socket.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }));
						})
						.catch(e => console.log(e));
				});
			});
		})
	}


	handleVideo = () => {
		this.setState({
			video: !this.state.video,
		}, () => {
			this.getUserMedia()
		})
	}

	handleAudio = () => {
		this.setState({
			audio: !this.state.audio,
		}, () => {
			this.getUserMedia()
		})
	}

	handleScreen = () => {
		this.setState({
			screen: !this.state.screen
		}, () => {
			this.getDislayMedia()
		})
	}

	handleEndCall = () => {
		try {
			let tracks = this.localVideoref.current.srcObject.getTracks()
			tracks.forEach(track => track.stop())
		} catch (e) {

		}

		window.location.href = "/"
	}

	

	openChat = () => {
		this.setState({
			showModal: true,
		}, () => {})
	}

	closeChat = () => {
		this.setState({
			showModal: false,
		}, () => {})
	}

	handleMessage = (e) => {
		this.setState({
			message: e.target.value,
		}, () => {})
	}

	addMessage = (data, sender) => {
		this.setState(prevState => ({
			messages: [...prevState.messages, {"sender": sender, "data": data}]
		}))
	}

	sendMessage = () => {
		socket.emit('chat-message', this.state.message)
		this.setState({
			message: "",
		}, () => {})
	}

	copyUrl = (e) => {
		var text = window.location.href

		if (!navigator.clipboard) {
			var textArea = document.createElement("textarea")
			textArea.value = text
			document.body.appendChild(textArea)
			textArea.focus()
			textArea.select()
			try {
				var successful = document.execCommand('copy');
				var msg = successful ? 'successful' : 'unsuccessful';
				console.log(msg)
				message.success("Link copied to clipboard!")
			} catch (err) {
				message.error("Failed to copy")
			}
			document.body.removeChild(textArea)
			return
		}
		navigator.clipboard.writeText(text).then(function () {
			message.success("Link copied to clipboard!")
		}, function (err) {
			message.error("Failed to copy")
		})
	}

	render() {
		return (
			<div>
				<div className="btn-down" style={{backgroundColor: "whitesmoke", color: "whitesmoke", textAlign: "center"}}>
					<IconButton style={{ color: "#424242" }} onClick={this.handleVideo}>
						{(this.state.video === true) ? <VideocamIcon /> : <VideocamOffIcon />}
					</IconButton>

					<IconButton style={{ color: "#f44336" }} onClick={this.handleEndCall}>
						<CallEndIcon />
					</IconButton>

					<IconButton style={{ color: "#424242" }} onClick={this.handleAudio}>
						{this.state.audio === true ? <MicIcon /> : <MicOffIcon />}
					</IconButton>

					{this.state.screenAvailable === true ?
						<IconButton style={{ color: "#424242" }} onClick={this.handleScreen}>
							{this.state.screen === true ? <ScreenShareIcon /> : <StopScreenShareIcon />}
						</IconButton>
					: null }

					<IconButton style={{ color: "#424242" }} onClick={this.openChat}>
						<ChatIcon />
					</IconButton>
				</div>

				<Modal show={this.state.showModal} onHide={this.closeChat} style={{zIndex: "999999"}}>
					<Modal.Header closeButton>
					<Modal.Title>Chat Room</Modal.Title>
					</Modal.Header>
					<Modal.Body style={{overflow: "auto", overflowY: "auto", height: "400px"}} >
						{this.state.messages.length > 0 ? this.state.messages.map((item) => (
							<div><b>{item.sender}</b><p style={{ wordBreak: "break-all"}}>{item.data}</p></div>
						)) : <p>No message yet</p>}
					</Modal.Body>
					<Modal.Footer className="div-send-msg">
						<Input placeholder="Message" value={this.state.message} onChange={e => this.handleMessage(e)} />
						<Button variant="contained" color="primary" onClick={this.sendMessage}>Send</Button>
					</Modal.Footer>
				</Modal>
				
				<div className="container">
					<div style={{paddingTop: "20px"}}>
						<Input value={window.location.href} disable></Input>
						<Button style={{ 
							backgroundColor: "#3f51b5", 
							color: "whitesmoke", 
							marginLeft: "20px", 
							marginTop: "10px",
							width: "110px",
							fontSize: "10px"}} onClick={this.copyUrl}>Copy invite link</Button>
					</div>
					
					<Col id="main" className="flex-container">
						<video id="my-video" ref={this.localVideoref} autoPlay muted style={{
							borderStyle: "solid",
							borderColor: "#424242",
							margin: "10px", 
							objectFit: "fill",
							width: "100%", 
							height: "100%",}}></video>
					</Col>
				</div>
			</div>
		)
	}
}

export default Video2;