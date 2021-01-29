//output effects to chat at the start of a token's turn
Hooks.on("updateCombat", (tracker) =>{
	if(game.settings.get("ae-to-chat", "startTurn") === "none") return;
	if(game.user === game.users.find((u) => u.isGM && u.active)){
		let hookType = "updateCombat"
		const combatant = tracker.combatant;
		const tokenData = combatant.token;
		const scene = tracker.scene;
		if (!tokenData || //combatant isn't a token
			(game.settings.get("ae-to-chat","startTurn")=== "linked" && !tokenData.actorLink) || //setting is set to linked only and actor is not linked
			game.settings.get("ae-to-chat","startTurn")=== "player" && !(new Token(tokenData).actor.hasPlayerOwner)){ //setting is set to players only and actor is not owned by a player
				return;
		}
		const tempEffects = combatant.actor.temporaryEffects; 
		if (tempEffects.length === 0){
			return; //no chat message if no effects are present
		}
		const effects = tempEffects.map(e=>e.data);
		printActive(effects, tokenData, scene, hookType)
	}
}
);

//output new effects to chat.
//define an empty array on startup
let effectArray = [];  // Expected array structure: [{actor: a, effect: effectData}], which will be deduped later to prevent race conditions
//set up a hook to start a timer when an effect is added
setHookOnce();

//set up a hook to add things t the array during the timer
Hooks.on("createActiveEffect",(actor, effectData) =>{
	if(game.settings.get("ae-to-chat", "onApply") === "none" || game.settings.get("ae-to-chat","startTurn")=== "player" && !actor.hasPlayerOwner) return;
	effectArray.push({actor:actor, effect:effectData}) 
});

//function to set up the timer hook.  TODO:  Make timeout configurable.
function setHookOnce(){
	Hooks.once("createActiveEffect",(actor) =>{
		if(game.settings.get("ae-to-chat", "onApply") === "none" || game.settings.get("ae-to-chat","startTurn")=== "player" && !actor.hasPlayerOwner) return;
    	setTimeout(processEffectArray, 300)
	})
};

function processEffectArray(){
	let hookType="createActiveEffect";
	let newArray = Array.from(effectArray); //might be able to naively assign here, but probably worth making a new object explictly just to be sure.	
	effectArray = []; //clear out the effectArray, so that it's available as soon as possible for 
	setHookOnce();
	console.log(newArray);
  
	//change newArray from [{actor, effectData}] form to [{actor, [effectData..]}] form
	newArray = newArray.reduce((accumilator, currentValue) => {
		if (!accumilator.find(e=> e?.actor === currentValue.actor)?.effects.push(currentValue.effect)){ //add the effect to the effects array of that actor (if it exists)
		accumilator.push({actor: currentValue.actor, effects: [currentValue.effect]})}; //if the actor isn't in the accumilator, add a new object for that actor to the array
		console.log(accumilator);
		return accumilator;
	}, []) //IMPORTANT: start with an empty array here

	console.log(newArray);

	newArray.forEach(o => {
		const tokenScene = getTokenDataSceneFromActor(o.actor);
		if(!tokenScene) return;//do nothing if there is no linked token
		const tokenData = tokenScene.tokenData;
		const scene = tokenScene.scene;  
		let effects = o.effects.filter(e => o.actor.temporaryEffects.find(t => t.id === e.id)); //filter the array down to only temporary effects, and covert to the appropriate format for printActive  
		console.log(effects, tokenData, scene);
		printActive(effects, tokenData, scene, hookType)
	})
};

function getTokenDataSceneFromActor(actor){
	let ts = game.scenes._source.map(s => s.tokens.map(t=> t= {token: t, scene: s})).flat();
	let linkedToken = ts.find(t => t.token.actorId === actor.id);
	if(!linkedToken) return;//do nothing if there is no linked token
	const tokenData = linkedToken.token;
	const scene = new Scene(linkedToken.scene);
	return {tokenData:tokenData, scene: scene};
}

Hooks.on("renderChatMessage",(app,html,data) => {
	_onRenderChatMessage(app,html,data);
});

//print active effects.  effects is an array [effectData,...], tokenData is tokenData, scene is a scene object
async function printActive(effects, tokenData, scene, hookType) {
	let subtitle;
	switch (hookType){ //allows adding a subtitle depending on the hook used (set as a variable, not autodetected).  Current could be an if statement, but, yknow, progress and such
		case "createActiveEffect":
			subtitle = `${game.i18n.localize("AE_TO_CHAT.ChatCard.AddEffect")} ${tokenData.name}`
			break;
		default:
			break;
	}
	//Assemble arguments in data for the template
	const templateData = {
		tokenData: tokenData,
		effects: effects,
		settings: {
			disable: game.settings.get("ae-to-chat","showDisable"),
			showinfo: game.settings.get("ae-to-chat","showShowInfo"),
			delete: game.settings.get("ae-to-chat","showDelete")
		},
		subtitle: subtitle
	}
	
	//Use the handlebars template to construct the chat message, and define the other things we need here
	const content = await renderTemplate("modules/ae-to-chat/templates/chatmessage.hbs",templateData);
	const speaker = await ChatMessage.getSpeaker({token: new Token(tokenData, scene)});
	const chatUser = game.userId;
	const chatType = CONST.CHAT_MESSAGE_TYPES.OTHER;
	
	//make the chat message
	const currentUser = game.userId;
	const gmUsers = game.users.filter(user => user.isGM && user.active);
	let whisperUsers = [];
	
	switch(game.settings.get("ae-to-chat","startTurnMessageMode")){
		case "gmwhisper":
			whisperUsers.push(gmUsers);
			if (gmUsers.includes(currentUser)) break; //don't add the current user to the array if they're already a GM, otherwise go to next step to add them
		case "whisper":
			whisperUsers.push(currentUser);
			break;
		default: //if setting is the wrong value, fall back to whisper user only
		case "public":
			break; //leaving the array of whisper recipients blank keeps the message public
	}

	return await ChatMessage.create({
		speaker,
		content,
		type: chatType,
		user: chatUser,
		whisper: whisperUsers
	});
}

async function _onRenderChatMessage(app, html, data) {
	if (data.message.content && !data.message.content.match("ae-to-chat")) {
		return;
	}

	const speaker = data.message.speaker;

	if (!speaker) return;

	const scene = game.scenes.get(speaker.scene) ?? null;
	const token = (canvas ? canvas?.tokens.get(speaker.token) : null) ?? (scene ? scene.data.tokens.find(t => t._id === speaker.token) : null);
	const deleteEffectAnchor = html.find("a[name='delete-row']");
	const disableEffectAnchor = html.find("a[name='disable-row']");
	const showInfoEffectAnchor = html.find("a[name='showinfo-row']");

	if (!token || (token && !game.user.isGM)) {
		deleteEffectAnchor?.parent().hide();
		disableEffectAnchor?.parent().hide();
		showInfoEffectAnchor?.parent().hide();
	}


	deleteEffectAnchor?.on("click", event => {
		async function anchorDelete(token, effectId, effectName){
			let content = ""                                    
			if(! await token.actor.effects.get(effectId)?.delete()){
				content = game.i18n.localize("AE_TO_CHAT.ChatCard.NoEffect")
			} else {content = `${game.i18n.localize("AE_TO_CHAT.ChatCard.EffectDeleted")} ${effectName}`};
			return content
		}

		_anchorHandler(event, anchorDelete);
	});

	disableEffectAnchor?.on("click", event => {
		async function anchorDisable(token, effectId, effectName) {
			let content;                                    
			if(! await token.actor.effects.get(effectId)?.update({disabled: true})){
				content = game.i18n.localize("AE_TO_CHAT.ChatCard.NoEffect")
			} else {content = `${game.i18n.localize("AE_TO_CHAT.ChatCard.EffectDisabled")} ${effectName}`};
			return content;
		}
		
		_anchorHandler(event, anchorDisable);
	});
	
	showInfoEffectAnchor?.on("click", event => {
		async function anchorShowInfo(token, effectId, effectName) {
			let content;                                    
			if(! await token.actor.effects.get(effectId)?.sheet.render(true)){
				content = game.i18n.localize("AE_TO_CHAT.ChatCard.NoEffect")
			}
			return content;
		}
		
		_anchorHandler(event, anchorShowInfo);
	});
}

async function _anchorHandler(event, anchorAction){
	//takes an event, returns null if either message, speaker, or token are missing, and returns {speaker, tokenData, effectId} otherwise
	//Speaker may not be needed in there, but it's a handy thing that contains a ton of other data, so... might as well
	//Grab all the relevant data from the message
	const effectListItem = event.target.closest("li");
	const effectId = effectListItem.dataset.effectId;
	const messageListItem = effectListItem?.parentElement?.closest("li");
	const messageId = messageListItem?.dataset?.messageId;
	const message = messageId ? game.messages.get(messageId) : null;
	//Check the message still exists (and wonder how they managed to click the button if it didn't)
	if (!message) return;
	const speaker = message?.data?.speaker;
	//Check the message has a speaker
	if (!speaker) return;
	const tokenData = game.scenes.get(speaker.scene).data.tokens.find(t => t._id===speaker.token);

	//Make sure the tokenData was fetched (i.e. the token exists)
	if (!tokenData) return;

	//Make a voodoo doll of the token from the incomplete token data
	const token = new Token(tokenData);
	const effectName = token.actor.effects.get(effectId)?.data.label;

	//pass the voodoo doll to the function that does the thing
	let content = await anchorAction(token, effectId, effectName);
	
	//Confirm in chat
	if (game.settings.get("ae-to-chat","confirmationMode") === "none") return; //no chat confirmation

	const currentUser = game.userId;
	const gmUsers = game.users.filter(user => user.isGM && user.active);
	let whisperUsers = [];
	
	switch(game.settings.get("ae-to-chat","confirmationMode")){
		case "gmwhisper":
			whisperUsers.push(gmUsers);
			if (gmUsers.includes(currentUser)) break; //don't add the current user to the array if they're already a GM, otherwise go to next step to add them
		default: //if setting is the wrong value, fall back to whisper user only
		case "whisper":
			whisperUsers.push(currentUser);
			break;
		case "public":
			break; //leaving the array of whisper recipients blank keeps the message public
	}

	const chatType = CONST.CHAT_MESSAGE_TYPES.WHISPER;
			
	//make the chat message, and whisper to the person that pressed the button.
	if(content){
		return ChatMessage.create({
			content,
			type: chatType,
			user: currentUser,
			whisper: whisperUsers
		});
	}
}