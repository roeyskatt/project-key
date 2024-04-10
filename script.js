const intro = document.getElementById('intro');
const play = document.getElementById('play');

const game_wasm = fetch('game.wasm');

play.onclick = function()
{
	intro.style.display = 'none';

	const div = document.getElementById('div');

	// TODO: show if window has focus?
	// TODO: pause if not focused?

	const COLOR_COUNT = 32;
	const PIXEL_BUFFER_W = 400;
	const PIXEL_BUFFER_H = 240;
	const INPUT_COUNT = 11;
	const SOUND_SAMPLES_PER_SECOND = 48000;
	const SOUND_SAMPLES_PER_CHUNK = SOUND_SAMPLES_PER_SECOND / 100;

	var memory = null;

	var palette = null;
	var pixels = null;
	var inputs = null;
	var inputs_old = new Uint8Array(INPUT_COUNT);
	var sound_chunk = null;

	function share_memory_(ptr_palette, ptr_pixels, ptr_inputs, ptr_sound_chunk)
	{
		palette = new Float32Array(memory.buffer, ptr_palette, COLOR_COUNT * 3);
		pixels = new Uint8Array(memory.buffer, ptr_pixels, PIXEL_BUFFER_W * PIXEL_BUFFER_H);
		inputs = new Uint8Array(memory.buffer, ptr_inputs, INPUT_COUNT);
		sound_chunk = new Float32Array(memory.buffer, ptr_sound_chunk, SOUND_SAMPLES_PER_CHUNK * 2);
	}

	// TODO: remove when metrics gets removed
	function set_uid_(ptr)
	{
		const uid = new Uint8Array(memory.buffer, ptr, 16);

		if (!localStorage.getItem('uid'))
		{
			const uid_str = get_seed_().toString(16).toUpperCase();

			localStorage.setItem('uid', uid_str);
		}

		{
			const uid_str = localStorage.getItem('uid');

			if (uid_str && uid_str.length == 16)
			{
				for (var i = 0; i < 16; i++)
				{
					uid[i] = uid_str.charCodeAt(i);
				}
			}
		}
	}

	const canvas = document.getElementById('canvas');
	// TODO: handle error
	// console.log(canvas);

	const gl = canvas.getContext('webgl2');
	// TODO: handle error
	// TODO: handle losing the context? can we simulate this?
	// console.log(gl);

	gl.disable(gl.BLEND);
	gl.disable(gl.CULL_FACE);
	gl.disable(gl.DEPTH_TEST);
	gl.blendEquation(gl.FUNC_ADD);
	gl.blendFunc(gl.ONE, gl.ZERO);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

	const sampler = gl.createSampler();
	gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.bindSampler(0, sampler);
	gl.bindSampler(1, sampler);

	const texture_palette = gl.createTexture();
	const texture_pixels = gl.createTexture();

	function create_shader_(gl, code, type)
	{
		const shader = gl.createShader(type);
		gl.shaderSource(shader, code);
		gl.compileShader(shader);

		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
		{
			// TODO: handle error
			const info = gl.getShaderInfoLog(shader);
			console.log('shader error:');
			console.log(info);
		}

		return shader;
	}

	const shader_vertex_code =
	`#version 300 es

	in vec2 pos;
	in vec2 uv;

	out vec2 uv_interpolated;

	void main()
	{
		uv_interpolated = uv;
		gl_Position = vec4(pos.x, pos.y, 0.0, 1.0);
	}
	`;
	const shader_vertex = create_shader_(gl, shader_vertex_code, gl.VERTEX_SHADER);

	const shader_fragment_code =
	`#version 300 es

	uniform highp usampler2D pixel_sampler;
	uniform highp sampler2D palette_sampler;

	in highp vec2 uv_interpolated;

	out highp vec4 fragment_color;

	void main()
	{
		uint color = texture(pixel_sampler, uv_interpolated).r;
		highp vec3 rgb = texelFetch(palette_sampler, ivec2(color, 0), 0).rgb;
		fragment_color = vec4(rgb, 1.0);
	}
	`;
	const shader_fragment = create_shader_(gl, shader_fragment_code, gl.FRAGMENT_SHADER);

	const program = gl.createProgram();
	gl.bindAttribLocation(program, 0, 'pos');
	gl.bindAttribLocation(program, 1, 'uv');
	gl.attachShader(program, shader_vertex);
	gl.attachShader(program, shader_fragment);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS))
	{
		// TODO: handle error
		const info = gl.getProgramInfoLog(program);
		console.log('program error:');
		console.log(info);
	}
	gl.useProgram(program);
	{
		const loc = gl.getUniformLocation(program, 'pixel_sampler');
		if (!loc)
		{
			// TODO: handle error
			console.log('"pixel_sampler" not found');
		}
		gl.uniform1i(loc, 0);
	}

	{	
		const loc = gl.getUniformLocation(program, 'palette_sampler');
		if (!loc)
		{
			// TODO: handle error
			console.log('"palette_sampler" not found');
		}
		gl.uniform1i(loc, 1);
	}

	const vertex_array = gl.createVertexArray();
	const buffer = gl.createBuffer();

	function renderer_draw_()
	{
		gl.clearColor(0.0, 0.0, 0.0, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.viewport(0, 0, PIXEL_BUFFER_W, PIXEL_BUFFER_H);

		gl.useProgram(program);

		{
			const level = 0;
			const internal_format = gl.RGB32F;
			const width = COLOR_COUNT;
			const height = 1;
			const border = 0;
			const src_format = gl.RGB;
			const src_type = gl.FLOAT;
			const src_data = palette;

			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, texture_palette);
			gl.texImage2D(gl.TEXTURE_2D, level, internal_format, width, height, border, src_format, src_type, src_data);
		}

		{
			const level = 0;
			const internal_format = gl.R8UI;
			const width = PIXEL_BUFFER_W;
			const height = PIXEL_BUFFER_H;
			const border = 0;
			const src_format = gl.RED_INTEGER;
			const src_type = gl.UNSIGNED_BYTE;
			const src_data = pixels;

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture_pixels);
			gl.texImage2D(gl.TEXTURE_2D, level, internal_format, width, height, border, src_format, src_type, src_data);
		}

		/*
		const window_width = canvas.width;
		const window_height = canvas.height;

		const ortho_width = 2.0 / window_width;
		const ortho_height = 2.0 / window_height;

		const scale_width = window_width / pixels_width;
		const scale_height = window_height / pixels_height;

		const scale = scale_width < scale_height ? scale_width : scale_height;

		const quad_width = pixels_width * 0.5 * ortho_width * scale;
		const quad_height = pixels_height * 0.5 * ortho_height * scale;

		const vertex_data = new Float32Array([
			-quad_width, -quad_height, 0.0, 0.0,
			-quad_width, +quad_height, 0.0, 1.0,
			+quad_width, +quad_height, 1.0, 1.0,
			+quad_width, -quad_height, 1.0, 0.0,
		]);
		*/

		const vertex_data = new Float32Array([
			-1.0, -1.0, 0.0, 0.0,
			-1.0, +1.0, 0.0, 1.0,
			+1.0, +1.0, 1.0, 1.0,
			+1.0, -1.0, 1.0, 0.0,
		]);

		const num_per_vertex = 2;
		const normalized = false;
		const stride = 16;

		gl.bindVertexArray(vertex_array);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

		gl.bufferData(gl.ARRAY_BUFFER, vertex_data, gl.DYNAMIC_DRAW);

		gl.vertexAttribPointer(0, num_per_vertex, gl.FLOAT, normalized, stride, 0);
		gl.enableVertexAttribArray(0);

		gl.vertexAttribPointer(1, num_per_vertex, gl.FLOAT, normalized, stride, stride / 2);
		gl.enableVertexAttribArray(1);

		gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

		gl.bindVertexArray(null);
	}

	// --

	const audio_context = new (window.AudioContext || window.webkitAudioContext)();

	const audio_buffer_options =
	{
		length: SOUND_SAMPLES_PER_SECOND,
		numberOfChannels: 2,
		sampleRate: SOUND_SAMPLES_PER_SECOND,
		channelCount: 2,
	};

	const audio_buffer = new AudioBuffer(audio_buffer_options);

	const audio_node_options =
	{
		buffer: audio_buffer,
		loop: true,
		channelCount: 2,
	};
	const audio_node = new AudioBufferSourceNode(audio_context, audio_node_options);

	audio_node.connect(audio_context.destination);
	audio_node.start();

	// console.log(audio_node);

	function audio_resume_()
	{
		audio_context.resume();
	}

	div.onclick = function()
	{
		audio_resume_();
	};

	var loop_sound_ = null;

	var samples_played = 0;
	var samples_output = 0;

	function do_sound_()
	{
		samples_played = audio_context.currentTime * SOUND_SAMPLES_PER_SECOND;

		const SOUND_SAMPLES_AHEAD = SOUND_SAMPLES_PER_CHUNK * 6;

		while (samples_output <= (samples_played + SOUND_SAMPLES_AHEAD))
		{
			loop_sound_();

			for (var c = 0; c < audio_buffer.numberOfChannels; c++)
			{
				const data = audio_buffer.getChannelData(c);

				for (var i = 0; i < SOUND_SAMPLES_PER_CHUNK; i++)
				{
					var index_src = c + (i * 2);
					var index_dst = samples_output + i;

					data[index_dst] = sound_chunk[index_src];
				}
			}

			samples_output += SOUND_SAMPLES_PER_CHUNK;
		}
	}

	// --

	const KEYBOARD_UP    = 0;
	const KEYBOARD_RIGHT = 1;
	const KEYBOARD_DOWN  = 2;
	const KEYBOARD_LEFT  = 3;
	const KEYBOARD_SPACE = 4;
	const KEYBOARD_ENTER = 5;
	const KEYBOARD_ESC   = 6;

	const keyboard = new Uint8Array(7);
	{
		function set_keyboard_key_(index, state, key_code, key_code_target)
		{
			if (key_code == key_code_target)
			{
				keyboard[index] = state;
			}
		}

		function set_keyboard_(state, key_code)
		{
			set_keyboard_key_(KEYBOARD_UP,    state, key_code, 38);
			set_keyboard_key_(KEYBOARD_RIGHT, state, key_code, 39);
			set_keyboard_key_(KEYBOARD_DOWN,  state, key_code, 40);
			set_keyboard_key_(KEYBOARD_LEFT,  state, key_code, 37);
			set_keyboard_key_(KEYBOARD_SPACE, state, key_code, 32);
			set_keyboard_key_(KEYBOARD_ENTER, state, key_code, 13);
			set_keyboard_key_(KEYBOARD_ESC,   state, key_code, 27);
		}

		document.onkeydown = function(e) { audio_resume_(); set_keyboard_(1, e.keyCode); };
		document.onkeyup   = function(e) { audio_resume_(); set_keyboard_(0, e.keyCode); };
	}

	function do_inputs_()
	{
		for (var i = 0; i < inputs.length; i++)
		{
			inputs_old[i] = inputs[i];
			inputs[i] = 0;
		}

		function set_input_(index, state)
		{
			if (index < inputs.length)
			{
				if (state)
				{
					inputs[index] = 1;
				}
			}
			else
			{
				// TODO: assert
			}
		}

		const MENU_PAUSE   =  0;
		const MENU_UP      =  1;
		const MENU_DOWN    =  2;
		const MENU_SELECT  =  3;
		const MENU_LEFT    =  4;
		const MENU_RIGHT   =  5;
		const AVATAR_LEFT  =  6;
		const AVATAR_RIGHT =  7;
		const AVATAR_DUCK  =  8;
		const AVATAR_JUMP  =  9;
		const AVATAR_WAND  = 10;

		{
			function key_pressed_(index)
			{
				if (index < keyboard.length)
				{
					return keyboard[index] != 0;
				}
				else
				{
					// TODO: assert?
				}
				return false;
			}

			set_input_(MENU_PAUSE,   key_pressed_(KEYBOARD_ESC));
			set_input_(MENU_UP,      key_pressed_(KEYBOARD_UP));
			set_input_(MENU_DOWN,    key_pressed_(KEYBOARD_DOWN));
			set_input_(MENU_SELECT,  key_pressed_(KEYBOARD_SPACE));
			set_input_(MENU_SELECT,  key_pressed_(KEYBOARD_ENTER));
			set_input_(MENU_LEFT,    key_pressed_(KEYBOARD_LEFT));
			set_input_(MENU_RIGHT,   key_pressed_(KEYBOARD_RIGHT));

			set_input_(AVATAR_LEFT,  key_pressed_(KEYBOARD_LEFT));
			set_input_(AVATAR_RIGHT, key_pressed_(KEYBOARD_RIGHT));
			set_input_(AVATAR_DUCK,  key_pressed_(KEYBOARD_DOWN));
			set_input_(AVATAR_JUMP,  key_pressed_(KEYBOARD_UP));
			set_input_(AVATAR_WAND,  key_pressed_(KEYBOARD_SPACE));
		}

		var gamepads = navigator.getGamepads();
		for (var i = 0; i < gamepads.length; i++)
		{
			var gamepad = gamepads[i];
			if (gamepad)
			{
				function button_pressed_(index)
				{
					if (index < gamepad.buttons.length)
					{
						return gamepad.buttons[index].pressed;
					}
					return false;
				}

				set_input_(MENU_PAUSE,   button_pressed_( 8));
				set_input_(MENU_PAUSE,   button_pressed_( 9));
				set_input_(MENU_UP,      button_pressed_(12));
				set_input_(MENU_DOWN,    button_pressed_(13));
				set_input_(MENU_SELECT,  button_pressed_( 0));
				set_input_(MENU_SELECT,  button_pressed_( 2));
				set_input_(MENU_LEFT,    button_pressed_(14));
				set_input_(MENU_RIGHT,   button_pressed_(15));

				set_input_(AVATAR_LEFT,  button_pressed_(14));
				set_input_(AVATAR_RIGHT, button_pressed_(15));
				set_input_(AVATAR_DUCK,  button_pressed_(13));
				set_input_(AVATAR_JUMP,  button_pressed_( 0));
				set_input_(AVATAR_WAND,  button_pressed_( 2));

				function axis_(index, positive, axis)
				{
					const axis_threshold = inputs_old[index] ? 0.35 : 0.375;
					const pressed = positive ? axis > +axis_threshold : axis < -axis_threshold;
					set_input_(index, pressed);
				}

				axis_(MENU_UP,      false, gamepad.axes[1]);
				axis_(MENU_DOWN,    true,  gamepad.axes[1]);
				axis_(MENU_LEFT,    false, gamepad.axes[0]);
				axis_(MENU_RIGHT,   true,  gamepad.axes[0]);

				axis_(AVATAR_LEFT,  false, gamepad.axes[0]);
				axis_(AVATAR_RIGHT, true,  gamepad.axes[0]);
				axis_(AVATAR_DUCK,  true,  gamepad.axes[1]);
			}
		}
	}

	function get_string_(ptr, len)
	{
		const array = new Uint8Array(memory.buffer, ptr, len);
		var str = '';
		for (var i = 0; i < len; i++)
		{
			str += String.fromCharCode(array[i]);
		}
		return str;
	}

	function print_(ptr, len)
	{
		const str = get_string_(ptr, len);
		console.log(str);
	}

	function print_val_(val)
	{
		console.log(val);
	}

	function print_bytes_(ptr, len)
	{
		const array = new Uint8Array(memory.buffer, ptr, len);
		console.log(array);
	}

	function fail_(ptr, len)
	{
		// TODO:

		const str = get_string_(ptr, len);
		const msg = 'FAIL: ' + str;

		console.log(msg);
		alert(msg);
		throw new Error(msg);
	}

	function get_seed_()
	{
		// TODO: have fallback if 'crypto' does not exist?

		const array = new Uint8Array(8);
		crypto.getRandomValues(array);

		var hex = '0x';
		for (var i = 0; i < 8; i++)
		{
			hex += ('0' + array[i].toString(16)).slice(-2);
			// hex += array[i].toString(16).padStart(2, '0');
		}

		return BigInt(hex);
	}

	function open_url_(url_ptr, url_len)
	{
		const window = document.defaultView; // TODO: check if 'Window'?
		const url = get_string_(url_ptr, url_len);
		const window_new = window.open(url, '_blank');
		if (window_new)
		{
			window_new.focus();
		}
	}

	// TODO: remove when metrics gets removed
	function post_to_discord_(web_hook_ptr, web_hook_len, message_ptr, message_len, record_bytes_ptr, record_bytes_len)
	{
		const web_hook = get_string_(web_hook_ptr, web_hook_len);
		const message = get_string_(message_ptr, message_len);
		const record_bytes = new Uint8Array(memory.buffer, record_bytes_ptr, record_bytes_len);

		const url = 'https://discord.com' + web_hook;
		// const body = JSON.stringify({ content: message });

		const body_a =   `--boundary\ncontent-disposition: form-data; name=file1; filename="record"\n\n`;
		const body_b = `\n--boundary\ncontent-disposition: form-data; name=content\n\n${message}\n--boundary--`;

		const body_a_bytes = Uint8Array.from(body_a, e => e.charCodeAt(0));
		const body_b_bytes = Uint8Array.from(body_b, e => e.charCodeAt(0));

		const body = new Uint8Array(body_a_bytes.length + record_bytes.length + body_b_bytes.length);
		body.set(body_a_bytes, 0);
		body.set(record_bytes, body_a_bytes.length);
		body.set(body_b_bytes, body_a_bytes.length + record_bytes.length);

		const request = new XMLHttpRequest();
		request.open("POST", url);
		// request.setRequestHeader('content-type', 'application/json');
		request.setRequestHeader('content-type', 'multipart/form-data; boundary=boundary');
		request.send(body);
	}

	function set_fullscreen_(fullscreen)
	{
		if (fullscreen)
		{
			div.requestFullscreen();
		}
		else
		{
			document.exitFullscreen();
		}
	}

	var import_object =
	{
		env:
		{
			print_: print_,
			print_float_: print_val_,
			print_u64_: print_val_,
			print_i64_: print_val_,
			print_bytes_: print_bytes_,

			share_memory_: share_memory_,
			set_uid_: set_uid_, // TODO: remove when metrics gets removed
			fail_: fail_,
			get_seed_: get_seed_,
			open_url_: open_url_,
			post_to_discord_: post_to_discord_, // TODO: remove when metrics gets removed
			set_fullscreen_: set_fullscreen_,
		}
	};

	function then_(obj)
	{
		// console.log(obj);

		memory = obj.instance.exports.memory;
		obj.instance.exports.memory.grow(64);
		obj.instance.exports.state_init_();

		loop_sound_ = obj.instance.exports.loop_sound_;

		var counter_last = performance.now(); // TODO: fallback if we don't have 'performance.now()'?
		var acc_sec = 0.0;

		function frame_()
		{
			{
				const MAX = 1.0 / 30.0;
				const counter_now = performance.now();
				const counter_diff = counter_now - counter_last;
				const seconds = counter_diff / 1000.0;
				acc_sec += (seconds > MAX ? MAX : seconds);
				counter_last = counter_now;
			}

			var steps = 0;
			{
				const SIM_FPS = 480;
				const SIM_SEC = 1.0 / SIM_FPS;

				while (acc_sec >= SIM_SEC)
				{
					acc_sec -= SIM_SEC;
					steps++;
				}
			}

			// console.log(steps);

			// var performance_then = performance.now();

			for (var step = 0; step < steps; step++)
			{
				const skip_draw = step < steps - 1;

				do_inputs_();

				obj.instance.exports.loop_game_(skip_draw);
			}

			// console.log((performance.now() - performance_then) + ' ms');

			renderer_draw_();

			do_sound_();

			requestAnimationFrame(frame_);
		}
		requestAnimationFrame(frame_);
	}

	WebAssembly.instantiateStreaming(game_wasm, import_object).then(then_);
}

