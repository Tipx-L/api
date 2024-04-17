function stringToUnreservedPortNumber(str: string) {
	let total = 0;

	for (let index = 0; index < str.length; index++) {
		total += str.charCodeAt(index);
	}

	const basePort = 1024;
	const maxPort = 65535;
	const range = maxPort - basePort;
	const portNumber = basePort + (total % range);
	return portNumber;
}

const portNumber = stringToUnreservedPortNumber("noname");
console.log(portNumber);
