import { ethers } from "ethers";
import { assert } from "chai";
import * as dotenv from "dotenv";

import pkg from 'c-kzg';
import * as path from 'path';

const {
    blobToKzgCommitment,
    computeBlobKzgProof,
    verifyBlobKzgProof,
    loadTrustedSetup
  } = pkg;
  
dotenv.config();

assert(process.env.OWNER_PK !== undefined);
assert(process.env.RPC_URL !== undefined);

const ownerPrivateKey: string = process.env.OWNER_PK;
const rpcUrl: string = process.env.RPC_URL;

// Setup provider, wallet
const provider: ethers.providers.JsonRpcProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
const signer: ethers.Wallet = new ethers.Wallet(ownerPrivateKey, provider);

async function sendRawTransaction() {
    const from: string = await signer.getAddress();
    const to: string = await ethers.Wallet.createRandom().getAddress();
    const nonce: number = await provider.getTransactionCount(from);
    const chainId: number = await signer.getChainId();
    const feeData: ethers.providers.FeeData = await provider.getFeeData();

    // console.log(feeData);

    // blob generation
    const BYTES_PER_BLOB = 4096 * 32
    let dummyBlob = Buffer.alloc(BYTES_PER_BLOB, "*")

    loadTrustedSetup(path.resolve("src/trusted_setup.txt"))
    const commitment = blobToKzgCommitment(dummyBlob);
    const proof = computeBlobKzgProof(dummyBlob, commitment);
    const isValid = verifyBlobKzgProof(dummyBlob, commitment, proof)

    console.log(isValid)
    console.log( "0x01" + ethers.utils.sha256(commitment).substr(4, 64)) // versioned hash
    
    const txPayloadBody = {
        chainId: ethers.utils.hexlify(chainId),
        nonce: ethers.utils.hexlify(nonce),
        maxPriorityFeePerGas: ethers.utils.hexlify(feeData.maxPriorityFeePerGas),
        maxFeePerGas: ethers.utils.hexlify(feeData.maxFeePerGas),
        gasLimit: ethers.utils.hexlify(250000),
        to,
        value: "0x",
        data: "0x",
        accessList: [],
        maxFeePerBlobGas: ethers.utils.hexlify(10000000),
        blobVersionedHashes: ["0x01" + ethers.utils.sha256(commitment).substr(4, 64)]
    };
    console.log(txPayloadBody);

    const rlpEncodedPayload = ethers.utils.RLP.encode(Object.values(txPayloadBody))
    console.log(rlpEncodedPayload)

    const BLOB_TX_TYPE = '0x03'; // source https://github.com/ethereum/EIPs/blob/master/EIPS/eip-4844.md
    const payloadForHashing = BLOB_TX_TYPE + rlpEncodedPayload.slice(2)
    console.log(payloadForHashing)

    // Calculate the digest
    const digest = ethers.utils.keccak256(payloadForHashing);
    const signature = await signer.signMessage(ethers.utils.arrayify(digest));
    const { r, s, v } = ethers.utils.splitSignature(signature);

    let signedTransaction = {
        ...txPayloadBody,
        y_parity: "0x0" + (v - 27),
        r: ethers.utils.hexZeroPad(r, 32),
        s: ethers.utils.hexZeroPad(s, 32),
    }
    console.log(signedTransaction)

    // https://github.com/ethereum/EIPs/blob/master/EIPS/eip-4844.md#networking
    const networkRepresentation = ethers.utils.RLP.encode([Object.values(signedTransaction), [dummyBlob], [commitment], [proof]])
    console.log(networkRepresentation.length)

    const txHash = await provider.send('eth_sendRawTransaction', [networkRepresentation]);
    return txHash;
}

sendRawTransaction()
    .catch(error => console.error(error));