var curModel = defaultModel;
const falconModel = "tiiuae/falcon-180B-chat";

function getConfig() {
  return modelConfigs[curModel];
}

var ws = null;
var position = 0;
const initialSessionLength = 512;
var sessionLength = initialSessionLength;
var connFailureBefore = false;

var totalElapsed, tokenCount;
let forceStop = false;

function openSession() {
  let protocol = location.protocol == "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/api/v2/generate`);
  ws.onopen = () => {
    ws.send(JSON.stringify({type: "open_inference_session", model: curModel, max_length: sessionLength}));
    ws.onmessage = event => {
      const response = JSON.parse(event.data);
      if (!response.ok) {
        handleFailure(response.traceback);
        return;
      }

      sendReplica();
    };
  };

  ws.onerror = _event => handleFailure(`Connection failed`);
  ws.onclose = _event => {
    if ($(".error-box").is(":hidden")) {
      handleFailure(`Connection was closed`, true);
    }
  };
}

function resetSession() {
  if (ws !== null && ws.readyState <= 1) {  // If readyState is "connecting" or "opened"
    ws.close();
  }
  ws = null;
  position = 0;
}

function isWaitingForInputs() {
  return $('.human-replica textarea').length >= 1;
}

function sendReplica() {
  if (isWaitingForInputs()) {
    const aiPrompt = "HyperGPT:";
    const date = new Date().toLocaleString();

    // if ($('.human-replica').length == 1) {
      // console.log(".human-replica true")
      $('.dialogue').append(
        `<div class="flex flex-row justify-end">` +
          `<div class="flex flex-col relative space-x-1 space-y-1 text-right rounded p-3 max-w-[80%] md:min-w-[290px] bg-blue-500">` +
            `<div class="flex relative space-x-1 flex-row space-x-reverse">` +
              `<span class="inline-flex space-x-2 items-start text-white">` +
                `<div class="message text-white">You: ${$('#human-replica-input').val()}</div>` +
              `</span>` +
            `</div>` +
            `<div class="flex flex-col">` +
              `<div class="flex flex-row justify-between">` +
                `<div class="text-xs text-white/50">${date}</div>` +
              `</div>` +
            `</div>` +
          `</div>` +
        `</div>`
      );

    // }

    $('.human-replica:last').html($('#human-replica-input').val());

    $('#human-replica-input').prop( "disabled", true );

    $("#human-replica-input").css("color","gray");


    $('.dialogue').append($(
      `<div class="flex flex-row justify-start">` +
        `<div class="flex flex-col relative space-x-1 space-y-1 text-left bg-[#4a9c6d] rounded max-w-[80%] md:min-w-[290px] p-3">` +
          `<div class="flex relative space-x-1 flex-row space-x-reverse">` +
            `<span class="inline-flex space-x-7 items-center text-white b g-[#4a9c6d]">` +
              `<span class="ai-replica max-w-sm"><span class="text">${aiPrompt}</span></span>` +
            `</span>` +
          `</div>` +
          `<div class="px-3">` +
            '<div class="dot-flashing"></div>' +
          `</div>` +
          `<div class="flex flex-col">` +
            `<div class="flex flex-col text-left">` +
              '<span class="generation-controls text-xs text-white/50"><a class="stop-generation underline" href=#>stop generation</a></span>' +
              '<span class="speed text-xs text-white/90" style="display: none;"></span>' +
            `</div>` +
            '<span class="suggest-join text-left text-xs text-white" style="display: none;">' +
              '<b>Too slow?</b> ' +
              '<a target="_blank" href="https://www.hypertensor.app" class="underline">The ability to connect your GPU coming soon</a> ' +
            '</span>' +
          `</div>` +
          `<div class="flex flex-col">` +
            `<div class="flex flex-row justify-between">` +
              `<div class="text-xs text-white/50">${date}</div>` +
            `</div>` +
          `</div>` +
        `</div>` +
      `</div>`
    ));

    const scrollElement = document.getElementById("scroller")
    const scrollHeight = scrollElement.scrollHeight

    $('#scroller').scrollTop(scrollHeight);

    animateLoading();
    $('.stop-generation').click(e => {
      e.preventDefault();
      console.log("Stop generation");
      forceStop = true;
    });
  } else {
    // $('.loading-animation').show();
    $('.dot-flashing').show();
  }

  if (ws === null) {
    openSession();
    return;
  }

  const replicaDivs = $('.human-replica, .ai-replica .text');
  var replicas = [];
  for (var i = position; i < replicaDivs.length; i++) {
    const el = $(replicaDivs[i]);
    console.log("replicaDivs val()", el.val())
    console.log("replicaDivs text()", el.text())
    var phrase = el.text();
    if (curModel === falconModel) {
      if (i < 2) {
        // Skip the system prompt and the 1st assistant's message to match the HF demo format precisely
        continue;
      }
      phrase = phrase.replace(/^Human:/, 'User:');
      phrase = phrase.replace(/^Assistant:/, 'Falcon:');
    }
    if (el.is(".human-replica")) {
      phrase += getConfig().chat.sep_token;
    } else
    if (i < replicaDivs.length - 1) {
      phrase += getConfig().chat.stop_token;
    }
    replicas.push(phrase);
  }
  console.log("replicas", replicas)

  // there is some input bug on jquery keypress
  // in case it fire twice, don't run the query
  if (replicas.length === 0) {
    console.log("replicas.length === 0")
    return
  }
  
  const inputs = replicas.join("");
  position = replicaDivs.length;

  totalElapsed = 0;
  tokenCount = 0;
  receiveReplica(inputs);
}

function receiveReplica(inputs) {
  ws.send(JSON.stringify({
    type: "generate",
    inputs: inputs,
    max_new_tokens: 1,
    stop_sequence: getConfig().chat.stop_token,
    extra_stop_sequences: getConfig().chat.extra_stop_sequences,
    ...getConfig().chat.generation_params,
  }));

  var lastMessageTime = null;
  ws.onmessage = event => {
    connFailureBefore = false;  // We've managed to connect after a possible failure

    const response = JSON.parse(event.data);
    if (!response.ok) {
      handleFailure(response.traceback);
      return;
    }

    if (lastMessageTime != null) {
      totalElapsed += performance.now() - lastMessageTime;
      tokenCount += response.token_count;
    }
    lastMessageTime = performance.now();

    const lastReplica = $('.ai-replica .text').last();
    var newText = lastReplica.text() + response.outputs;
    if (curModel !== falconModel) {
      newText = newText.replace(getConfig().chat.stop_token, "");
    }
    if (getConfig().chat.extra_stop_sequences !== null) {
      for (const seq of getConfig().chat.extra_stop_sequences) {
        newText = newText.replace(seq, "");
      }
    }
    lastReplica.text(newText);

    if (!response.stop && !forceStop) {
      if (tokenCount >= 1) {
        const speed = tokenCount / (totalElapsed / 1000);
        $('.speed')
          .text(`Speed: ${speed.toFixed(1)} tokens/sec`)
          .show();
        if (speed < 1) {
          $('.suggest-join').show();
        }
      }
    } else {
      if (forceStop) {
        resetSession();
        forceStop = false;
      }
      // $('.loading-animation, .speed, .suggest-join, .generation-controls').remove();
      $('.loading-animation, .dot-flashing, .speed, .suggest-join, .generation-controls').remove();
      appendTextArea();
      $('#human-replica-input').val('')
      $('#human-replica-input').prop( "disabled", false);
      $("#human-replica-input").css("color","white");
    }
  };
}

function handleFailure(message, autoRetry = false) {
  resetSession();
  if (!isWaitingForInputs()) {
    // Show the error and the retry button only if a user is waiting for the generation results

    if (message === "Connection failed" && !connFailureBefore) {
      autoRetry = true;
      connFailureBefore = true;
    }
    if (/Session .+ expired/.test(message)) {
      autoRetry = true;
    }
    const maxSessionLength = getConfig().chat.max_session_length;
    if (/Maximum length exceeded/.test(message) && sessionLength < maxSessionLength) {
      // We gradually increase sessionLength to save server resources. Default: 512 -> 2048 -> 8192 (if supported)
      sessionLength = Math.min(sessionLength * 4, maxSessionLength);
      autoRetry = true;
    }

    if (autoRetry) {
      retry();
    } else {
      $('.loading-animation').hide();
      if (/attention cache is full/.test(message)) {
        $('.error-message').hide();
        $('.out-of-capacity').show();
      } else {
        $('.out-of-capacity').hide();
        $('.error-message').text(message).show();
      }
      $('.error-box').show();
    }
  }
}

function retry() {
  $('.error-box').hide();
  sendReplica();
}

function appendTextArea() {
  const humanPrompt = "Human: ";
  // $('.dialogue').append($(
  //   `<div class="human-replica text-white hidden"><textarea class="form-control" id="exampleTextarea" rows="2">${humanPrompt}</textarea></div>`
  // ));
  $('.dialogue').append($(
    `<div class="human-replica text-white hidden"><textarea class="form-control" id="exampleTextarea" rows="2"></textarea></div>`
  ));

  // $('.dialogue').append($(
  //   `<div class="message text-white">${humanPrompt}</div>`
  // ));
  $('.dialogue').append($(
    `<div class="message text-white hidden"></div>`
  ));
  upgradeTextArea();
}

function upgradeTextArea() {
  // const textarea = $('.human-replica textarea');
  const textarea = $('#human-replica-input');
  // console.log("upgradeTextArea textarea", textarea)
  autosize(textarea);
  // textarea[0].selectionStart = textarea[0].value.length;
  textarea.focus();

  // $(document).unbind('keypress').bind('keypress', function (e) {
  //   // some logic here
  // });

  textarea.on('keypress', e => {
    if (e.which == 13 && !e.shiftKey) {
      console.log("keypressed")
      e.preventDefault();
      e.stopPropagation();
      sendReplica();
    }
  });
}

function upgradeSendButton() {
  const button = $('#human-replica-button');

  button.on('click', e => {
    console.log("keypressed")
    e.preventDefault();
    e.stopPropagation();
    sendReplica();
  });
}

// const animFrames = ["⌛", "🧠", "🅱️", "Ḃ", "Ƀ", "Ḅ", "Ḇ", "Ɓ"];
const animFrames = ["⌛", "🧠", "🅱️"];
var curFrame = 0;

function animateLoading() {
  $('.loading-animation').html(' &nbsp;' + animFrames[curFrame]);
  curFrame = (curFrame + 1) % animFrames.length;
}

$(() => {
  upgradeTextArea();

  $('.family-selector label').click(function (e) {
    if (!isWaitingForInputs()) {
      alert("Can't switch the model while the AI is writing a response. Please refresh the page");
      e.preventDefault();
      return;
    }

    const radio = $(`#${$(this).attr("for")}`);
    if (radio.is(":checked")) {
      setTimeout(() => $('.human-replica textarea').focus(), 10);
      return;
    }

    const curFamily = radio.attr("value");
    $('.model-selector').hide();
    const firstLabel = $(`.model-selector[data-family=${curFamily}]`).show().children('label:first');
    firstLabel.click();
    firstLabel.trigger('click');
  });
  $('.model-selector label').click(function (e) {
    if (!isWaitingForInputs()) {
      alert("Can't switch the model while the AI is writing a response. Please refresh the page");
      e.preventDefault();
      return;
    }

    curModel = $(`#${$(this).attr("for")}`).attr("value");
    $('.dialogue p').slice(2).remove();

    sessionLength = initialSessionLength;
    resetSession();
    appendTextArea();

    $('.model-name')
      .text($(this).text())
      .attr('href', getConfig().frontend.model_card);
    $('.license-link').attr('href', getConfig().frontend.license);
    setTimeout(() => $('.human-replica textarea').focus(), 10);
  });
  $('.retry-link').click(e => {
    e.preventDefault();
    retry();
  });

  setInterval(animateLoading, 2000);
});